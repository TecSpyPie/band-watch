package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
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
