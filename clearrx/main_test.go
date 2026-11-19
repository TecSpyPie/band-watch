package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func do(t *testing.T, a *App, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, req)
	return w
}

func TestHealthz(t *testing.T) {
	a := NewApp("", nil)
	w := do(t, a, "GET", "/healthz", "", map[string]string{"Origin": "http://localhost:8073"})
	var h map[string]any
	json.Unmarshal(w.Body.Bytes(), &h)
	if h["ok"] != true || h["app"] != "clearrx" || h["bandWatchLinked"] != false {
		t.Fatalf("healthz = %v", h)
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:8073" {
		t.Fatal("Band Watch should be allowed to read healthz")
	}
}

func TestOtherSitesCantReadSettings(t *testing.T) {
	a := NewApp("", nil)
	w := do(t, a, "GET", "/api/settings", "", map[string]string{"Origin": "https://evil.example"})
	if w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("another site must not be allowed to read the settings")
	}
	w = do(t, a, "POST", "/api/settings", `{"preset":"cw"}`, map[string]string{"Origin": "https://evil.example"})
	if w.Code != 403 {
		t.Fatalf("POST from another site = %d", w.Code)
	}
	w = do(t, a, "POST", "/api/settings", `{"preset":"cw"}`, map[string]string{"Origin": "http://localhost:8073"})
	if w.Code != 403 {
		t.Fatalf("POST from Band Watch = %d (it only reads them)", w.Code)
	}
}

func TestSettingsSavedCheckedAndLinked(t *testing.T) {
	file := filepath.Join(t.TempDir(), "s.json")
	a := NewApp(file, nil)
	w := do(t, a, "POST", "/api/settings", `{"preset":"weird","radio":"spaceship","lo":5,"hi":99999,"tone":700,"width":200,"nrLevel":9,"nr":true,"on":true}`, nil)
	if w.Code != 200 {
		t.Fatalf("POST = %d %s", w.Code, w.Body)
	}
	var s Settings
	json.Unmarshal(w.Body.Bytes(), &s)
	if s.Radio != "other" {
		t.Fatalf("radio not checked: %q", s.Radio)
	}
	if s.Preset != "custom" || s.Lo != 50 || s.Hi != 8000 || s.NrLevel != 3 || !s.Nr {
		t.Fatalf("not cleaned: %+v", s)
	}
	if b, err := os.ReadFile(file); err != nil || !strings.Contains(string(b), `"custom"`) {
		t.Fatalf("not saved: %v %s", err, b)
	}
	// It comes back after a restart
	if b := NewApp(file, nil).settings; b.Preset != "custom" || b.Lo != 50 {
		t.Fatalf("not loaded: %+v", b)
	}
	// Band Watch reading the settings shows as "linked" for a few seconds
	now := time.Now()
	a.now = func() time.Time { return now }
	do(t, a, "GET", "/api/settings", "", map[string]string{"Origin": "http://127.0.0.1:8073"})
	w = do(t, a, "GET", "/healthz", "", nil)
	if !strings.Contains(w.Body.String(), `"bandWatchLinked":true`) {
		t.Fatalf("expected linked: %s", w.Body)
	}
	now = now.Add(time.Minute)
	w = do(t, a, "GET", "/healthz", "", nil)
	if !strings.Contains(w.Body.String(), `"bandWatchLinked":false`) {
		t.Fatalf("expected not linked: %s", w.Body)
	}
}

func TestQuitNeedsHeader(t *testing.T) {
	quit := make(chan bool, 1)
	a := NewApp("", func() { quit <- true })
	if w := do(t, a, "POST", "/api/quit", "", nil); w.Code != 403 {
		t.Fatalf("quit without header = %d", w.Code)
	}
	if w := do(t, a, "GET", "/api/quit", "", map[string]string{"X-ClearRX": "quit"}); w.Code != 403 {
		t.Fatalf("GET quit = %d", w.Code)
	}
	if w := do(t, a, "POST", "/api/quit", "", map[string]string{"X-ClearRX": "quit"}); w.Code != 200 {
		t.Fatalf("quit = %d", w.Code)
	}
	select {
	case <-quit:
	case <-time.After(2 * time.Second):
		t.Fatal("didn't quit")
	}
}

func TestPageServed(t *testing.T) {
	a := NewApp("", nil)
	for _, p := range []string{"/", "/js/app.js", "/js/clearrx-worklet.js", "/js/rxfx.js", "/clearrx.css", "/favicon.svg"} {
		w := do(t, a, "GET", p, "", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("%s = %d", p, w.Code)
		}
		if w.Header().Get("X-Frame-Options") != "DENY" {
			t.Fatalf("%s missing security headers", p)
		}
	}
	if !strings.Contains(do(t, a, "GET", "/", "", nil).Body.String(), "ClearRX by M3VRV") {
		t.Fatal("page title missing")
	}
}

func TestAppWindowArgs(t *testing.T) {
	args := appWindowArgs("http://localhost:8074/")
	if args[0] != "--app=http://localhost:8074/" {
		t.Fatalf("args = %v", args)
	}
}
