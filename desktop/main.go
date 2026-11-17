package main

// BandWatch.exe: starts the Band Watch server on this PC and opens it in the web browser.
//
//   BandWatch.exe               start (or, if already running, just open the browser)
//   BandWatch.exe --background  start without opening the browser (used at Windows start-up)
//   BandWatch.exe --stop        stop a running Band Watch
//
// For tests and Linux: BW_TEST=1 PORT=1234 bandwatch --serve  (no browser, no localhost guard, test hooks on)

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const defaultPort = 8073

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	serve := flag.Bool("serve", false, "run the server only (for tests)")
	background := flag.Bool("background", false, "start without opening the browser")
	stop := flag.Bool("stop", false, "stop a running Band Watch")
	showVersion := flag.Bool("version", false, "print the version")
	flag.Parse()

	if *showVersion {
		if buildDate != "" {
			fmt.Println(version, "built", buildDate)
		} else {
			fmt.Println(version)
		}
		return
	}

	cfg := defaultConfig()
	cfg.NoaaURL = env("BW_NOAA_URL", cfg.NoaaURL)
	cfg.PskURL = env("BW_PSK_URL", cfg.PskURL)
	cfg.QrzURL = env("BW_QRZ_URL", cfg.QrzURL)

	if *serve {
		cfg.TestHooks = os.Getenv("BW_TEST") == "1"
		port := env("PORT", "8080")
		host := env("HOST", "127.0.0.1")
		srv := &http.Server{Addr: net.JoinHostPort(host, port), Handler: NewServer(cfg), ReadHeaderTimeout: 10 * time.Second}
		log.Printf("Band Watch by M3vrv %s listening on %s", version, srv.Addr)
		log.Fatal(srv.ListenAndServe())
	}

	port := defaultPort
	if p, err := strconv.Atoi(os.Getenv("BANDWATCH_PORT")); err == nil && p > 0 {
		port = p
	}
	setupLog()
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	pageURL := fmt.Sprintf("http://localhost:%d/", port)

	if *stop {
		if askToQuit(base) {
			waitFree(port, 5*time.Second)
		}
		stopOldNodeServer()
		return
	}

	// Already running?
	switch running, ver := probe(base); {
	case running && ver == version:
		if !*background {
			openBrowser(pageURL)
		}
		return
	case running:
		// An older Band Watch: ask it to stop (older Node.js versions are stopped directly).
		log.Printf("stopping Band Watch %s to start %s", ver, version)
		askToQuit(base)
		if !waitFree(port, 5*time.Second) {
			stopOldNodeServer()
			waitFree(port, 8*time.Second)
		}
	}

	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		if running, _ := probe(base); !running {
			messageBox("Band Watch by M3vrv", fmt.Sprintf("Band Watch couldn't start because another program is using port %d.\n\nClose that program and try again.", port))
		} else {
			openBrowser(pageURL)
		}
		log.Printf("listen: %v", err)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	cfg.Desktop = true
	cfg.Quit = cancel
	app := NewServer(cfg)
	srv := &http.Server{Handler: app, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		app.StopRtlTcp()
		shutdown, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		srv.Shutdown(shutdown)
	}()
	log.Printf("Band Watch by M3vrv %s (built %s) running at %s", version, buildDate, pageURL)
	if !*background {
		go func() {
			time.Sleep(300 * time.Millisecond)
			openBrowser(pageURL)
		}()
	}
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("serve: %v", err)
	}
	log.Printf("Band Watch stopped")
}

// probe says whether Band Watch answers on this port, and which version.
func probe(base string) (bool, string) {
	c := http.Client{Timeout: 2 * time.Second}
	res, err := c.Get(base + "/healthz")
	if err != nil {
		return false, ""
	}
	defer res.Body.Close()
	var h struct {
		OK      bool   `json:"ok"`
		Version string `json:"version"`
	}
	b, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	if json.Unmarshal(b, &h) != nil || !h.OK {
		return false, ""
	}
	return true, h.Version
}

func askToQuit(base string) bool {
	c := http.Client{Timeout: 3 * time.Second}
	req, _ := http.NewRequest("POST", base+"/api/quit", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	res, err := c.Do(req)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == 200
}

// waitFree waits until nothing is listening on the port.
func waitFree(port int, d time.Duration) bool {
	end := time.Now().Add(d)
	for time.Now().Before(end) {
		ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			ln.Close()
			return true
		}
		time.Sleep(250 * time.Millisecond)
	}
	return false
}

// logDir is where bandwatch.log goes: next to BandWatch.exe (C:\BandWatch), so everything Band Watch
// keeps is in its install folder. If that folder can't be written, %LOCALAPPDATA%\BandWatch.
func logDir() string {
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		if f, err := os.CreateTemp(dir, ".bw-log-test-*"); err == nil {
			name := f.Name()
			f.Close()
			os.Remove(name)
			return dir
		}
	}
	dir := os.Getenv("LOCALAPPDATA")
	if dir == "" {
		dir = os.TempDir()
	}
	dir = filepath.Join(dir, "BandWatch")
	os.MkdirAll(dir, 0o755)
	return dir
}

func setupLog() {
	p := filepath.Join(logDir(), "bandwatch.log")
	if fi, err := os.Stat(p); err == nil && fi.Size() > 1<<20 {
		os.Rename(p, p+".old")
	}
	if f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(f)
	}
}
