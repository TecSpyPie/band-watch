package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDesktopOnlyAnswersOnLocalhost(t *testing.T) {
	s := NewServer(Config{Desktop: true})
	for host, want := range map[string]int{"localhost:8073": 200, "127.0.0.1:8073": 200, "[::1]:8073": 200, "evil.example:8073": 421, "localhost.evil.example": 421} {
		req := httptest.NewRequest("GET", "/healthz", nil)
		req.Host = host
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("host %s: got %d, want %d", host, rec.Code, want)
		}
	}
}

func TestHealthzSaysDesktop(t *testing.T) {
	s := NewServer(Config{Desktop: true})
	req := httptest.NewRequest("GET", "/healthz", nil)
	req.Host = "localhost:8073"
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `"desktop":true`) {
		t.Fatalf("healthz: %s", rec.Body.String())
	}
}

func TestQuitNeedsJSONAndDesktop(t *testing.T) {
	quit := make(chan struct{}, 1)
	s := NewServer(Config{Desktop: true, Quit: func() { quit <- struct{}{} }})
	post := func(ct string) int {
		req := httptest.NewRequest("POST", "/api/quit", strings.NewReader("{}"))
		req.Host = "localhost:8073"
		if ct != "" {
			req.Header.Set("Content-Type", ct)
		}
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, req)
		return rec.Code
	}
	if c := post("text/plain"); c != 415 {
		t.Fatalf("plain post: %d", c)
	}
	if c := post("application/json"); c != 200 {
		t.Fatalf("json post: %d", c)
	}
	select {
	case <-quit:
	case <-time.After(2 * time.Second):
		t.Fatal("quit was not called")
	}
	web := NewServer(Config{})
	req := httptest.NewRequest("POST", "/api/quit", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	web.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("quit on the web version: %d", rec.Code)
	}
}

func TestLocator(t *testing.T) {
	lat, lon, ok := locatorToLatLon("IO93")
	if !ok || lat != 53.5 || lon != -1 {
		t.Fatal(lat, lon, ok)
	}
	if _, _, ok := locatorToLatLon("ZZ99"); ok {
		t.Fatal("ZZ99 accepted")
	}
	a, b, _ := locatorToLatLon("IO93fa12")
	c, d, _ := locatorToLatLon("io93fa")
	if a != c || b != d {
		t.Fatal("8 and 6 character locators differ")
	}
}

/* ---------- /api/myreports (FT8 and FT4 reports of your own callsign) ---------- */

func myRx(sender, rx, loc, mode string, hz int, ageSec int, snr string) string {
	return fmt.Sprintf(`<receptionReport senderCallsign="%s" senderLocator="IO93fa" receiverCallsign="%s" receiverLocator="%s" frequency="%d" flowStartSeconds="%d" mode="%s" sNR="%s" />`,
		sender, rx, loc, hz, time.Now().Unix()-int64(ageSec), mode, snr)
}

func TestParseMyReportsXML(t *testing.T) {
	xml := "<receptionReports>" +
		myRx("G4XYZ", "K1ABC", "FN42aa", "FT8", 14074500, 60, "-12") +
		myRx("G4XYZ", "JA1ZZZ", "PM95", "FT4", 7047500, 3000, "3") +
		myRx("G4XYZ", "WSPRRX", "FN42aa", "WSPR", 14097100, 60, "-12") +
		myRx("N0OTH", "K1ABC", "FN42aa", "FT8", 14074500, 60, "-12") +
		myRx("G4XYZ", "NOLOC", "", "FT8", 14074500, 60, "-12") +
		myRx("G4XYZ", "NOSNR", "FN42aa", "FT8", 14074500, 60, "") +
		myRx("G4XYZ", "", "FN42aa", "FT8", 14074500, 60, "-1") +
		myRx("G4XYZ", "AB&amp;C", "FN42aa", "FT8", 14074500, 100, "-1") +
		"</receptionReports>"
	got := parseMyReportsXML([]byte(xml), "G4XYZ")
	var calls []string
	for _, r := range got {
		calls = append(calls, r.C)
	}
	if strings.Join(calls, ",") != "JA1ZZZ,AB&C,K1ABC" {
		t.Fatalf("got %v, want oldest first with unusable rows left out", calls)
	}
	ja := got[0]
	if ja.G != "PM95" || ja.Lat != 35.5 || ja.Lon != 139 || ja.Fq != 7.0475 || ja.M != "FT4" || ja.SNR != 3 {
		t.Fatalf("JA1ZZZ: %+v", ja)
	}
}

func myReportsServer(t *testing.T, handler http.HandlerFunc) (*Server, *int32) {
	t.Helper()
	var calls int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		handler(w, r)
	}))
	t.Cleanup(up.Close)
	return NewServer(Config{PskURL: up.URL + "/psk/query"}), &calls
}

func getMy(s *Server, path string) (int, string) {
	req := httptest.NewRequest("GET", path, nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func TestMyReportsValidatesBeforeAskingUpstream(t *testing.T) {
	s, calls := myReportsServer(t, func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<receptionReports/>")) })
	for _, p := range []string{
		"/api/myreports", "/api/myreports?call=", "/api/myreports?call=XX", "/api/myreports?call=G4ABC;DROP",
		"/api/myreports?call=a%20b", "/api/myreports?call=%27%20OR%201=1", "/api/myreports?call=TOOLONGCALL1",
		"/api/myreports?call=G4ABC/", "/api/myreports?call=G4XYZ&mins=0", "/api/myreports?call=G4XYZ&mins=-5",
		"/api/myreports?call=G4XYZ&mins=abc", "/api/myreports?call=G4XYZ&mins=1.5", "/api/myreports?call=G4XYZ&mins=1e3",
	} {
		if code, _ := getMy(s, p); code != 400 {
			t.Errorf("%s: got %d, want 400", p, code)
		}
	}
	if n := atomic.LoadInt32(calls); n != 0 {
		t.Fatalf("invalid requests reached PSK Reporter %d times", n)
	}
}

func TestMyReportsQueryCacheAndTrim(t *testing.T) {
	var gotQuery url.Values
	s, calls := myReportsServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query()
		time.Sleep(50 * time.Millisecond) // so concurrent requests overlap
		w.Write([]byte("<receptionReports>" +
			myRx("G4XYZ", "K1ABC", "FN42aa", "FT8", 14074500, 60, "-12") +
			myRx("G4XYZ", "DL1OLD", "JO62", "FT8", 14074500, 7200, "-20") + "</receptionReports>"))
	})
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); getMy(s, "/api/myreports?call=g4xyz") }()
	}
	wg.Wait()
	code, body := getMy(s, "/api/myreports?call=G4XYZ&mins=10")
	if code != 200 || !strings.Contains(body, `"K1ABC"`) || strings.Contains(body, "DL1OLD") || !strings.Contains(body, `"mins":10`) {
		t.Fatalf("trimmed answer: %d %s", code, body)
	}
	if _, body := getMy(s, "/api/myreports?call=G4XYZ&mins=999999"); !strings.Contains(body, "DL1OLD") || !strings.Contains(body, `"mins":1440`) {
		t.Fatalf("capped answer: %s", body)
	}
	if n := atomic.LoadInt32(calls); n != 1 {
		t.Fatalf("concurrent and repeated requests made %d upstream calls, want 1", n)
	}
	if gotQuery.Get("senderCallsign") != "G4XYZ" || gotQuery.Get("flowStartSeconds") != "-86400" || gotQuery.Get("rronly") != "1" || gotQuery.Get("noactive") != "1" {
		t.Fatalf("upstream query: %v", gotQuery)
	}
	if c := gotQuery.Get("appcontact"); !strings.HasPrefix(c, "https://github.com/") || strings.Contains(c, "@") {
		t.Fatalf("appcontact should be the project's address, got %q", c)
	}
	s.clock.Advance(4 * time.Minute)
	getMy(s, "/api/myreports?call=G4XYZ")
	if n := atomic.LoadInt32(calls); n != 1 {
		t.Fatalf("asked again after only 4 minutes (%d calls)", n)
	}
	getMy(s, "/api/myreports?call=M0ABC")
	if n := atomic.LoadInt32(calls); n != 2 {
		t.Fatalf("another callsign should be fetched separately (%d calls)", n)
	}
	s.clock.Advance(2 * time.Minute)
	getMy(s, "/api/myreports?call=G4XYZ")
	if n := atomic.LoadInt32(calls); n != 3 {
		t.Fatalf("should ask again after 5 minutes (%d calls)", n)
	}
}

func TestMyReportsStaleAndFailure(t *testing.T) {
	down := int32(0)
	s, _ := myReportsServer(t, func(w http.ResponseWriter, r *http.Request) {
		if atomic.LoadInt32(&down) == 1 {
			w.WriteHeader(503)
			return
		}
		w.Write([]byte("<receptionReports>" + myRx("G4XYZ", "K1ABC", "FN42aa", "FT8", 14074500, 60, "-12") + "</receptionReports>"))
	})
	atomic.StoreInt32(&down, 1)
	code, body := getMy(s, "/api/myreports?call=G4XYZ")
	if code != 502 || body != `{"error":"upstream feed unavailable"}` {
		t.Fatalf("nothing cached and PSK Reporter down: %d %s", code, body)
	}
	atomic.StoreInt32(&down, 0)
	if code, _ := getMy(s, "/api/myreports?call=G4XYZ"); code != 200 {
		t.Fatalf("recovered: %d", code)
	}
	atomic.StoreInt32(&down, 1)
	s.clock.Advance(6 * time.Minute)
	code, body = getMy(s, "/api/myreports?call=G4XYZ")
	if code != 200 || !strings.Contains(body, `"stale":true`) || !strings.Contains(body, "K1ABC") {
		t.Fatalf("stale answer: %d %s", code, body)
	}
}
