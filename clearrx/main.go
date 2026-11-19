// ClearRX by M3VRV: a radio audio processor for Windows. It takes the sound from your radio (its USB sound card, or a
// line-in) and plays it back cleaned up: a voice filter, a CW peak filter, an auto notch, noise reduction and steady
// volume. It runs on this PC only (http://localhost:8074) and shows in a window of its own.
//
// It's a program of its own, but it works with Band Watch: while ClearRX is open, Band Watch can send its RTL-SDR
// sound through ClearRX's settings (Band Watch reads them from /api/settings).
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed all:public
var embedded embed.FS

var (
	version   = "dev"
	buildDate = ""
)

const defaultPort = 8074

// Band Watch's own addresses: the only pages, besides ClearRX itself, that may read ClearRX's settings.
var bandWatchOrigins = map[string]bool{"http://localhost:8073": true, "http://127.0.0.1:8073": true}

// Settings are ClearRX's switches, as the page sends them. Every field is checked before it's kept.
type Settings struct {
	Preset  string `json:"preset"`
	Voice   bool   `json:"voice"`
	Lo      int    `json:"lo"`
	Hi      int    `json:"hi"`
	Cw      bool   `json:"cw"`
	Tone    int    `json:"tone"`
	Width   int    `json:"width"`
	Notch   bool   `json:"notch"`
	Nr      bool   `json:"nr"`
	NrLevel int    `json:"nrLevel"`
	Comp    bool   `json:"comp"`
	On      bool   `json:"on"`    // ClearRX's power switch: off means "leave the sound alone"
	Radio   string `json:"radio"` // "My radio": rtl, yaesu, icom, ats, malahit, other (or "" before one is picked)
}

var radios = map[string]bool{"": true, "rtl": true, "yaesu": true, "icom": true, "ats": true, "malahit": true, "other": true}

var presets = map[string]bool{"off": true, "ssb": true, "weak": true, "cw": true, "am": true, "custom": true}

func defaultSettings() Settings {
	return Settings{Preset: "ssb", Voice: true, Lo: 300, Hi: 2700, Tone: 700, Width: 200, Notch: true, NrLevel: 1, Comp: true, On: true}
}

func clampInt(v, lo, hi, def int) int {
	if v == 0 {
		return def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// clean keeps settings within sensible ranges (the same as the sound engine, rxfx.js).
func (s Settings) clean() Settings {
	if !presets[s.Preset] {
		s.Preset = "custom"
	}
	s.Lo = clampInt(s.Lo, 50, 1500, 300)
	s.Hi = clampInt(s.Hi, s.Lo+300, 8000, 2700)
	s.Tone = clampInt(s.Tone, 300, 1500, 700)
	s.Width = clampInt(s.Width, 50, 800, 200)
	s.NrLevel = clampInt(s.NrLevel, 1, 3, 1)
	if !radios[s.Radio] {
		s.Radio = "other"
	}
	return s
}

// App is ClearRX's little web server.
type App struct {
	mu         sync.Mutex
	settings   Settings
	file       string // where the settings are saved ("" in tests)
	lastLinked time.Time
	quit       func()
	static     http.Handler
	now        func() time.Time
}

func NewApp(file string, quit func()) *App {
	sub, err := fs.Sub(embedded, "public")
	if err != nil {
		panic(err)
	}
	a := &App{settings: defaultSettings(), file: file, quit: quit, now: time.Now}
	a.static = http.FileServer(http.FS(sub))
	if file != "" {
		if b, err := os.ReadFile(file); err == nil {
			var s Settings
			if json.Unmarshal(b, &s) == nil {
				a.settings = s.clean()
			}
		}
	}
	return a
}

var securityHeaders = map[string]string{
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy":        "no-referrer",
	"X-Frame-Options":        "DENY",
}

func sendJSON(w http.ResponseWriter, code int, v any) {
	for k, val := range securityHeaders {
		w.Header().Set(k, val)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// allowBandWatch lets Band Watch's page read ClearRX's answers (and nobody else's page).
func allowBandWatch(w http.ResponseWriter, r *http.Request) bool {
	o := r.Header.Get("Origin")
	if !bandWatchOrigins[o] {
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", o)
	w.Header().Set("Vary", "Origin")
	return true
}

func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/healthz":
		allowBandWatch(w, r)
		a.mu.Lock()
		linked := !a.lastLinked.IsZero() && a.now().Sub(a.lastLinked) < 10*time.Second
		a.mu.Unlock()
		sendJSON(w, 200, map[string]any{"ok": true, "app": "clearrx", "version": version, "build": buildDate, "bandWatchLinked": linked})
		return
	case "/api/settings":
		a.settingsAPI(w, r)
		return
	case "/api/quit":
		// Only ClearRX's own page or ClearRX.exe --stop (which send this header; another site's page can't)
		if r.Method != http.MethodPost || r.Header.Get("X-ClearRX") != "quit" {
			sendJSON(w, 403, map[string]string{"error": "not allowed"})
			return
		}
		sendJSON(w, 200, map[string]bool{"ok": true})
		if a.quit != nil {
			go func() { time.Sleep(200 * time.Millisecond); a.quit() }()
		}
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		sendJSON(w, 405, map[string]string{"error": "method not allowed"})
		return
	}
	p := path.Clean(r.URL.Path)
	if t := mime.TypeByExtension(path.Ext(p)); t != "" {
		w.Header().Set("Content-Type", t)
	}
	if p == "/" || strings.HasSuffix(p, ".html") || strings.HasSuffix(p, ".js") || strings.HasSuffix(p, ".css") {
		w.Header().Set("Cache-Control", "no-cache")
	}
	for k, val := range securityHeaders {
		w.Header().Set(k, val)
	}
	a.static.ServeHTTP(w, r)
}

func (a *App) settingsAPI(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		fromBandWatch := allowBandWatch(w, r)
		a.mu.Lock()
		s := a.settings
		if fromBandWatch {
			a.lastLinked = a.now()
		}
		a.mu.Unlock()
		sendJSON(w, 200, s)
	case http.MethodPost:
		// Only ClearRX's own page changes them (a same-origin request: no Origin, or ClearRX's own)
		if o := r.Header.Get("Origin"); o != "" && !strings.HasPrefix(o, "http://localhost:") && !strings.HasPrefix(o, "http://127.0.0.1:") {
			sendJSON(w, 403, map[string]string{"error": "not allowed"})
			return
		}
		if o := r.Header.Get("Origin"); bandWatchOrigins[o] {
			sendJSON(w, 403, map[string]string{"error": "ClearRX's settings are changed in ClearRX"})
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 4096))
		var s Settings
		if err != nil || json.Unmarshal(body, &s) != nil {
			sendJSON(w, 400, map[string]string{"error": "expected ClearRX settings"})
			return
		}
		s = s.clean()
		a.mu.Lock()
		a.settings = s
		file := a.file
		a.mu.Unlock()
		if file != "" {
			if b, err := json.MarshalIndent(s, "", "  "); err == nil {
				_ = os.WriteFile(file, b, 0o644)
			}
		}
		sendJSON(w, 200, s)
	default:
		sendJSON(w, 405, map[string]string{"error": "method not allowed"})
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	serve := flag.Bool("serve", false, "run the server only (for tests)")
	stop := flag.Bool("stop", false, "stop a running ClearRX")
	showVersion := flag.Bool("version", false, "print the version")
	flag.Parse()
	if *showVersion {
		fmt.Println(version, buildDate)
		return
	}
	if *serve {
		addr := net.JoinHostPort(env("HOST", "127.0.0.1"), env("PORT", "8080"))
		log.Printf("ClearRX by M3VRV %s listening on %s", version, addr)
		log.Fatal((&http.Server{Addr: addr, Handler: NewApp("", nil), ReadHeaderTimeout: 10 * time.Second}).ListenAndServe())
	}

	port := defaultPort
	if p, err := strconv.Atoi(os.Getenv("CLEARRX_PORT")); err == nil && p > 0 {
		port = p
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	pageURL := fmt.Sprintf("http://localhost:%d/", port)
	exeDir := "."
	if exe, err := os.Executable(); err == nil {
		exeDir = filepath.Dir(exe)
	}
	setupLog(exeDir)

	if *stop {
		askToQuit(base)
		return
	}
	// Already open? Show it (or, if it's an older ClearRX, stop that one first).
	if ok, ver := probe(base); ok {
		if ver == version {
			openWindow(pageURL)
			return
		}
		askToQuit(base)
		time.Sleep(time.Second)
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		messageBox("ClearRX by M3VRV", fmt.Sprintf("ClearRX couldn't start because another program is using port %d.", port))
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	app := NewApp(filepath.Join(exeDir, "clearrx-settings.json"), cancel)
	srv := &http.Server{Handler: app, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		done, c := context.WithTimeout(context.Background(), 3*time.Second)
		defer c()
		srv.Shutdown(done)
	}()
	log.Printf("ClearRX by M3VRV %s (built %s) running at %s", version, buildDate, pageURL)
	go func() { time.Sleep(300 * time.Millisecond); openWindow(pageURL) }()
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("serve: %v", err)
	}
	log.Printf("ClearRX stopped")
}

func probe(base string) (bool, string) {
	c := http.Client{Timeout: 2 * time.Second}
	res, err := c.Get(base + "/healthz")
	if err != nil {
		return false, ""
	}
	defer res.Body.Close()
	var h struct {
		OK      bool   `json:"ok"`
		App     string `json:"app"`
		Version string `json:"version"`
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	if json.Unmarshal(b, &h) != nil || !h.OK || h.App != "clearrx" {
		return false, ""
	}
	return true, h.Version
}

func askToQuit(base string) {
	req, _ := http.NewRequest(http.MethodPost, base+"/api/quit", nil)
	req.Header.Set("X-ClearRX", "quit")
	c := http.Client{Timeout: 2 * time.Second}
	if res, err := c.Do(req); err == nil {
		res.Body.Close()
	}
}

// setupLog writes ClearRX's log next to it (clearrx.log), kept small.
func setupLog(dir string) {
	p := filepath.Join(dir, "clearrx.log")
	if st, err := os.Stat(p); err == nil && st.Size() > 256*1024 {
		_ = os.Remove(p)
	}
	if f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(f)
	}
}
