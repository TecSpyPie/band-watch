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
		t.Fatal("HamShack should be allowed to read healthz")
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
		t.Fatalf("POST from HamShack = %d (it only reads them)", w.Code)
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
	// HamShack reading the settings shows as "linked" for a few seconds
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

func TestExtrasCheckedAndKept(t *testing.T) {
	a := NewApp("", nil)
	w := do(t, a, "POST", "/api/settings", `{"preset":"ssb","nb":true,"nbLevel":7,"agc":"warp","sq":-200,"bass":30,"treble":-30,"mnotch":20}`, nil)
	if w.Code != 200 {
		t.Fatalf("POST = %d %s", w.Code, w.Body)
	}
	var s Settings
	json.Unmarshal(w.Body.Bytes(), &s)
	if !s.Nb || s.NbLevel != 3 || s.Agc != "medium" || s.Sq != -80 || s.Bass != 12 || s.Treble != -12 || s.Mnotch != 200 {
		t.Fatalf("extras not cleaned: %+v", s)
	}
	// 0 means off for the squelch, tone and manual notch, and stays 0
	w = do(t, a, "POST", "/api/settings", `{"preset":"ssb","agc":"slow","sq":0,"bass":0,"treble":-3,"mnotch":0}`, nil)
	json.Unmarshal(w.Body.Bytes(), &s)
	if s.Agc != "slow" || s.Sq != 0 || s.Bass != 0 || s.Treble != -3 || s.Mnotch != 0 || s.NbLevel != 2 {
		t.Fatalf("off values changed: %+v", s)
	}
	// Settings saved by older ClearRX versions get the extras' defaults
	if d := (Settings{Preset: "ssb"}).clean(); d.NbLevel != 2 || d.Agc != "medium" || d.Sq != 0 {
		t.Fatalf("old settings: %+v", d)
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
	for _, p := range []string{"/", "/js/app.js", "/js/clearrx-worklet.js", "/js/rxfx.js", "/js/scope3d.js", "/clearrx.css", "/favicon.svg"} {
		w := do(t, a, "GET", p, "", nil)
		if w.Code != http.StatusOK {
			t.Fatalf("%s = %d", p, w.Code)
		}
		if w.Header().Get("X-Frame-Options") != "DENY" {
			t.Fatalf("%s missing security headers", p)
		}
	}
	if !strings.Contains(do(t, a, "GET", "/", "", nil).Body.String(), "ClearRX by M3VRV &amp; King Coder") {
		t.Fatal("page title missing")
	}
}

func TestAppWindowArgs(t *testing.T) {
	args := appWindowArgs("http://localhost:8074/")
	if args[0] != "--app=http://localhost:8074/" {
		t.Fatalf("args = %v", args)
	}
}

// The rack: order, graphic EQ and compressor / limiter settings

func postSettings(t *testing.T, a *App, body string) Settings {
	t.Helper()
	w := do(t, a, "POST", "/api/settings", body, nil)
	if w.Code != 200 {
		t.Fatalf("POST = %d %s", w.Code, w.Body)
	}
	var s Settings
	if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestRackDefaults(t *testing.T) {
	d := defaultSettings().clean()
	if strings.Join(d.Order, ",") != "nb,voice,cw,mnotch,notch,snr,nr,sq,comp,eq,tone,cmp" {
		t.Fatalf("default order = %v", d.Order)
	}
	if d.Eq || d.EqPreset != "flat" || len(d.EqGains) != 10 || d.Cmp || d.CmpThr != -18 || d.CmpRatio != 3 || d.CmpMakeup != 0 || !d.CmpLimit {
		t.Fatalf("defaults: %+v", d)
	}
	for _, g := range d.EqGains {
		if g != 0 {
			t.Fatalf("EQ should start flat: %v", d.EqGains)
		}
	}
}

func TestRackOrderChecked(t *testing.T) {
	a := NewApp("", nil)
	// Unknown ids and repeats go; missing modules are added at the end, in the usual order
	s := postSettings(t, a, `{"preset":"ssb","order":["cmp","bogus","eq","cmp","","nb"]}`)
	if got := strings.Join(s.Order, ","); got != "cmp,eq,nb,voice,cw,mnotch,notch,snr,nr,sq,comp,tone" {
		t.Fatalf("order = %s", got)
	}
	// Always every module exactly once
	for _, in := range []string{`[]`, `null`, `["eq","eq","eq"]`, `["x","y"]`} {
		s = postSettings(t, a, `{"preset":"ssb","order":`+in+`}`)
		seen := map[string]int{}
		for _, id := range s.Order {
			seen[id]++
		}
		if len(s.Order) != len(modules) || len(seen) != len(modules) {
			t.Fatalf("order %s -> %v", in, s.Order)
		}
	}
	// A wrong type is refused, and the settings stay as they were
	if w := do(t, a, "POST", "/api/settings", `{"order":"eq"}`, nil); w.Code != 400 {
		t.Fatalf("order as a string = %d", w.Code)
	}
}

func TestRackEqAndCompressorClamped(t *testing.T) {
	a := NewApp("", nil)
	s := postSettings(t, a, `{"preset":"custom","eq":true,"eqPreset":"warp","eqGains":[40,-40,3,0,0,0,0,0,0,0,9,9],"cmp":true,"cmpThr":-300,"cmpRatio":99,"cmpMakeup":99,"cmpLimit":false}`)
	if !s.Eq || s.EqPreset != "custom" {
		t.Fatalf("eq: %+v", s)
	}
	if len(s.EqGains) != 10 || s.EqGains[0] != 12 || s.EqGains[1] != -12 || s.EqGains[2] != 3 {
		t.Fatalf("gains not clamped or cut to ten: %v", s.EqGains)
	}
	if !s.Cmp || s.CmpThr != -60 || s.CmpRatio != 20 || s.CmpMakeup != 24 || s.CmpLimit {
		t.Fatalf("compressor not clamped: %+v", s)
	}
	// The other end, and the values that must be kept as they are (0 dB is a real threshold; the limiter can be off)
	s = postSettings(t, a, `{"preset":"custom","eqPreset":"ssb","eqGains":[1,2],"cmpThr":0,"cmpRatio":-4,"cmpMakeup":-5,"cmpLimit":true}`)
	if s.EqPreset != "ssb" || s.EqGains[0] != 1 || s.EqGains[1] != 2 || s.EqGains[9] != 0 || len(s.EqGains) != 10 {
		t.Fatalf("short gains list should be padded: %v", s.EqGains)
	}
	if s.CmpThr != 0 || s.CmpRatio != 1 || s.CmpMakeup != 0 || !s.CmpLimit {
		t.Fatalf("compressor low end: %+v", s)
	}
	// A request without the new fields keeps the defaults (it doesn't switch the limiter off or zero the threshold)
	s = postSettings(t, a, `{"preset":"cw","cw":true}`)
	if s.CmpThr != -18 || s.CmpRatio != 3 || !s.CmpLimit || strings.Join(s.Order, ",") != strings.Join(modules, ",") {
		t.Fatalf("missing fields should be defaults: %+v", s)
	}
}

func TestRackOldSettingsFileStillWorks(t *testing.T) {
	// A clearrx-settings.json written by ClearRX 1.2.0, before the rack
	old := `{
  "preset": "weak", "voice": true, "lo": 300, "hi": 2400, "cw": false, "tone": 700, "width": 200, "notch": true, "nr": true, "nrLevel": 2,
  "comp": true, "on": true, "radio": "yaesu", "nb": true, "nbLevel": 3, "agc": "slow", "sq": -55, "bass": 3, "treble": -3, "mnotch": 1500
}`
	file := filepath.Join(t.TempDir(), "clearrx-settings.json")
	if err := os.WriteFile(file, []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewApp(file, nil).settings
	// Everything that was saved is kept
	if s.Preset != "weak" || s.Hi != 2400 || !s.Nr || s.NrLevel != 2 || s.Radio != "yaesu" || !s.Nb || s.NbLevel != 3 || s.Agc != "slow" ||
		s.Sq != -55 || s.Bass != 3 || s.Treble != -3 || s.Mnotch != 1500 || !s.Voice || !s.On {
		t.Fatalf("old values lost: %+v", s)
	}
	// And the rack's fields are the defaults
	if strings.Join(s.Order, ",") != strings.Join(modules, ",") || s.Eq || s.EqPreset != "flat" || len(s.EqGains) != 10 || s.Cmp || s.CmpThr != -18 || s.CmpRatio != 3 || !s.CmpLimit {
		t.Fatalf("rack defaults missing: %+v", s)
	}
	// The page gets them all from /api/settings
	a := NewApp(file, nil)
	w := do(t, a, "GET", "/api/settings", "", nil)
	for _, key := range []string{`"order":["nb"`, `"eqGains":[0,0,0,0,0,0,0,0,0,0]`, `"cmpLimit":true`, `"eq":false`, `"eqPreset":"flat"`, `"cmpThr":-18`} {
		if !strings.Contains(w.Body.String(), key) {
			t.Fatalf("settings JSON missing %s: %s", key, w.Body)
		}
	}
	// A broken or empty file falls back to the defaults
	for _, junk := range []string{``, `not json`, `{"order": 5}`} {
		if err := os.WriteFile(file, []byte(junk), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := NewApp(file, nil).settings; got.Preset != "ssb" || len(got.Order) != len(modules) || len(got.EqGains) != 10 {
			t.Fatalf("junk file %q: %+v", junk, got)
		}
	}
}

func TestRackSavedAndLoadedBack(t *testing.T) {
	file := filepath.Join(t.TempDir(), "s.json")
	a := NewApp(file, nil)
	postSettings(t, a, `{"preset":"custom","order":["cmp","eq","nb"],"eq":true,"eqPreset":"cw","eqGains":[-10,-8,-4,3,6,3,-4,-8,-10,-12],"cmp":true,"cmpThr":-24,"cmpRatio":6,"cmpMakeup":4,"cmpLimit":false}`)
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"cmp"`) || !strings.Contains(string(b), `"eqGains"`) {
		t.Fatalf("not saved: %s", b)
	}
	s := NewApp(file, nil).settings
	if strings.Join(s.Order[:3], ",") != "cmp,eq,nb" || !s.Eq || s.EqPreset != "cw" || s.EqGains[4] != 6 || s.EqGains[9] != -12 ||
		!s.Cmp || s.CmpThr != -24 || s.CmpRatio != 6 || s.CmpMakeup != 4 || s.CmpLimit {
		t.Fatalf("not loaded back: %+v", s)
	}
}

func TestHissRemoverChecked(t *testing.T) {
	a := NewApp("", nil)
	// Defaults: off, 15 dB, no learnt noise
	s := postSettings(t, a, `{"preset":"ssb"}`)
	if s.Snr || s.SnrLevel != 15 || s.SnrProfile == nil || len(s.SnrProfile) != 0 {
		t.Fatalf("hiss remover defaults: %+v", s)
	}
	// Strength clamped to 6..30
	if s = postSettings(t, a, `{"snr":true,"snrLevel":99}`); !s.Snr || s.SnrLevel != 30 {
		t.Fatalf("strength high: %d", s.SnrLevel)
	}
	if s = postSettings(t, a, `{"snrLevel":-4}`); s.SnrLevel != 6 {
		t.Fatalf("strength low: %d", s.SnrLevel)
	}
	// A learnt noise of the right length is kept (each number clamped); a wrong length is dropped
	nums := make([]string, snrBins)
	for i := range nums {
		nums[i] = "-700"
	}
	nums[0], nums[1] = "-99999", "99999"
	s = postSettings(t, a, `{"snr":true,"snrProfile":[`+strings.Join(nums, ",")+`]}`)
	if len(s.SnrProfile) != snrBins || s.SnrProfile[0] != -3000 || s.SnrProfile[1] != 600 || s.SnrProfile[2] != -700 {
		t.Fatalf("profile: len %d, %v", len(s.SnrProfile), s.SnrProfile[:3])
	}
	if s = postSettings(t, a, `{"snrProfile":[1,2,3]}`); len(s.SnrProfile) != 0 {
		t.Fatalf("a short profile should be dropped: %v", s.SnrProfile)
	}
	// A saved order from before the hiss remover gets it straight after the auto notch, not at the end
	s = postSettings(t, a, `{"order":["cmp","notch","nb","voice","cw","mnotch","nr","sq","comp","eq","tone"]}`)
	if got := strings.Join(s.Order, ","); got != "cmp,notch,snr,nb,voice,cw,mnotch,nr,sq,comp,eq,tone" {
		t.Fatalf("order = %s", got)
	}
}
