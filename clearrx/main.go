// ClearRX by M3VRV: a radio audio processor for Windows. It takes the sound from your radio (its USB sound card, or a
// line-in) and plays it back cleaned up: a voice filter, a CW peak filter, an auto notch, noise reduction and steady
// volume. It runs on this PC only (http://localhost:8074) and shows in a window of its own.
//
// It's a program of its own, but it works with HamShack: while ClearRX is open, HamShack can send its RTL-SDR
// sound through ClearRX's settings (HamShack reads them from /api/settings).
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

// HamShack's own addresses: the only pages, besides ClearRX itself, that may read ClearRX's settings.
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

	// The extras, kept whichever preset is picked
	Nb      bool   `json:"nb"`      // noise blanker
	NbLevel int    `json:"nbLevel"` // 1-3
	Agc     string `json:"agc"`     // the compressor's speed: fast, medium, slow
	Sq      int    `json:"sq"`      // squelch: dBFS (-80 to -20), 0 = off
	Bass    int    `json:"bass"`    // dB, -12 to +12
	Treble  int    `json:"treble"`  // dB, -12 to +12
	Mnotch  int    `json:"mnotch"`  // manual notch: Hz (200-3000), 0 = off

	// The hiss remover (spectral noise reduction): on, how strong (dB), and the noise it was taught with Learn noise
	// (257 numbers, one per pitch, in tenths of a dB; empty = it follows the noise by itself)
	Snr        bool  `json:"snr"`
	SnrLevel   int   `json:"snrLevel"`   // 6 to 30 dB
	SnrProfile []int `json:"snrProfile"` // empty, or exactly snrBins numbers, each -3000 to 600

	// The rack: the order the modules work in, the graphic EQ and the compressor / limiter.
	// Files saved by older versions have none of these: they get the defaults (see defaultSettings).
	// A module is switched on by its own field (voice, cw, notch, snr, nr, comp, nb, eq, cmp); the manual notch, squelch
	// and bass/treble are on whenever their value (mnotch, sq, bass or treble) is not 0.
	Order     []string `json:"order"`     // module ids, top to bottom (see modules); anything missing is added at the end
	Eq        bool     `json:"eq"`        // graphic EQ on
	EqPreset  string   `json:"eqPreset"`  // flat, ssb, weak, cw, am, or custom: which curve the gains are
	EqGains   []int    `json:"eqGains"`   // ten bands (100 Hz to 5 kHz), dB, -12 to +12
	Cmp       bool     `json:"cmp"`       // compressor / limiter on
	CmpThr    int      `json:"cmpThr"`    // threshold: dBFS, -60 to 0
	CmpRatio  int      `json:"cmpRatio"`  // 1 to 20 (to 1)
	CmpMakeup int      `json:"cmpMakeup"` // make-up gain: dB, 0 to 24
	CmpLimit  bool     `json:"cmpLimit"`  // the limiter: holds the sound under -1 dBFS
}

var agcSpeeds = map[string]bool{"fast": true, "medium": true, "slow": true}

// modules are the rack's modules in their usual order (the same ids and order as MODULES in rxfx.js).
var modules = []string{"nb", "voice", "cw", "mnotch", "notch", "snr", "nr", "sq", "comp", "eq", "tone", "cmp"}

// moduleAfter: a module added in a later version goes after this one in an order saved before it existed
var moduleAfter = map[string]string{"snr": "notch"}

const snrBins = 257 // the hiss remover's pitches (a 512-point FFT)

const eqBands = 10 // the graphic EQ: 100, 200, 300, 500, 800, 1200, 1800, 2500, 3500, 5000 Hz

var eqPresets = map[string]bool{"flat": true, "ssb": true, "weak": true, "cw": true, "am": true, "custom": true}

// cleanOrder keeps a module order safe: unknown ids and repeats are dropped, and missing modules are added in their
// usual place (at the end, or after their moduleAfter module), the same as normalizeOrder in rxfx.js.
func cleanOrder(in []string) []string {
	out := make([]string, 0, len(modules))
	seen := map[string]bool{}
	known := map[string]bool{}
	for _, m := range modules {
		known[m] = true
	}
	for _, id := range in {
		if known[id] && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	for _, id := range modules {
		if !seen[id] && moduleAfter[id] == "" {
			seen[id] = true
			out = append(out, id)
		}
	}
	for _, id := range modules {
		if seen[id] {
			continue
		}
		seen[id] = true
		at := len(out)
		for i, o := range out {
			if o == moduleAfter[id] {
				at = i + 1
			}
		}
		out = append(out[:at], append([]string{id}, out[at:]...)...)
	}
	return out
}

// cleanProfile keeps a learnt noise only if it has exactly one number per pitch, each within range.
func cleanProfile(in []int) []int {
	if len(in) != snrBins {
		return []int{}
	}
	out := make([]int, snrBins)
	for i, v := range in {
		out[i] = max(-3000, min(600, v))
	}
	return out
}

// cleanGains makes exactly ten EQ gains, each -12 to +12 dB (a short list is padded with 0, a long one cut).
func cleanGains(in []int) []int {
	out := make([]int, eqBands)
	for i := range out {
		if i < len(in) {
			out[i] = max(-12, min(12, in[i]))
		}
	}
	return out
}

// clampOr0 keeps 0 as "off" and anything else within lo..hi.
func clampOr0(v, lo, hi int) int {
	if v == 0 {
		return 0
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

var radios = map[string]bool{"": true, "rtl": true, "yaesu": true, "icom": true, "ats": true, "malahit": true, "other": true}

var presets = map[string]bool{"off": true, "ssb": true, "weak": true, "cw": true, "am": true, "custom": true}

// defaultSettings are what a saved file or a request falls back to for anything it leaves out (so old files keep working).
func defaultSettings() Settings {
	return Settings{Preset: "ssb", Voice: true, Lo: 300, Hi: 2700, Tone: 700, Width: 200, Notch: true, NrLevel: 1, Comp: true, On: true, NbLevel: 2, Agc: "medium", SnrLevel: 15, SnrProfile: []int{},
		Order: cleanOrder(nil), EqPreset: "flat", EqGains: cleanGains(nil), CmpThr: -18, CmpRatio: 3, CmpLimit: true}
}

// parseSettings reads settings JSON on top of the defaults: a field that is missing keeps its default.
func parseSettings(b []byte) (Settings, error) {
	s := defaultSettings()
	err := json.Unmarshal(b, &s)
	return s, err
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
	s.NbLevel = clampInt(s.NbLevel, 1, 3, 2)
	if !agcSpeeds[s.Agc] {
		s.Agc = "medium"
	}
	s.SnrLevel = clampInt(s.SnrLevel, 6, 30, 15)
	s.SnrProfile = cleanProfile(s.SnrProfile)
	s.Sq = clampOr0(s.Sq, -80, -20)
	s.Bass = clampOr0(s.Bass, -12, 12)
	s.Treble = clampOr0(s.Treble, -12, 12)
	s.Mnotch = clampOr0(s.Mnotch, 200, 3000)
	s.Order = cleanOrder(s.Order)
	if !eqPresets[s.EqPreset] {
		s.EqPreset = "custom"
	}
	s.EqGains = cleanGains(s.EqGains)
	s.CmpThr = max(-60, min(0, s.CmpThr)) // 0 dB is a real threshold, so 0 doesn't mean "not set" here
	s.CmpRatio = clampInt(s.CmpRatio, 1, 20, 3)
	s.CmpMakeup = max(0, min(24, s.CmpMakeup))
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
			if s, err := parseSettings(b); err == nil {
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

// allowBandWatch lets HamShack's page read ClearRX's answers (and nobody else's page).
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
		body, err := io.ReadAll(io.LimitReader(r.Body, 16384)) // room for a learnt noise (257 numbers)
		s, perr := parseSettings(body)
		if err != nil || perr != nil {
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
		log.Printf("ClearRX by M3VRV & King Coder %s listening on %s", version, addr)
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
		messageBox("ClearRX by M3VRV & King Coder", fmt.Sprintf("ClearRX couldn't start because another program is using port %d.", port))
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
	log.Printf("ClearRX by M3VRV & King Coder %s (built %s) running at %s", version, buildDate, pageURL)
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
