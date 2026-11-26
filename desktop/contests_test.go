package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const contestRSS = `<?xml version="1.0"?><rss><channel>
<item><title>CQ WW DX Contest, CW</title><link>https://www.contestcalendar.com/contestdetails.php?ref=1</link><description>0000Z, Nov 28 to 2400Z, Nov 29</description></item>
<item><title>ARRL 10-Meter &amp; More</title><link>https://www.contestcalendar.com/contestdetails.php?ref=2</link><description>0000Z-0200Z, Dec 31</description></item>
<item><title>Late night sprint</title><link>https://www.contestcalendar.com/contestdetails.php?ref=3</link><description>2300Z-0100Z, Nov 26</description></item>
<item><title>Not from the calendar</title><link>https://example.com/x</link><description>0000Z-0100Z, Nov 27</description></item>
<item><title><![CDATA[Odd times]]></title><link>https://www.contestcalendar.com/contestdetails.php?ref=4</link><description>See rules</description></item>
</channel></rss>`

// The same cases as test/round2.test.js, so both servers answer alike.
func TestContestFeed(t *testing.T) {
	ref := time.Date(2026, 11, 26, 12, 0, 0, 0, time.UTC)
	c := parseContestFeed(contestRSS, ref)
	names := []string{}
	for _, x := range c {
		names = append(names, x["name"].(string))
	}
	if len(names) != 4 || names[0] != "CQ WW DX Contest, CW" || names[1] != "ARRL 10-Meter & More" || names[3] != "Odd times" {
		t.Fatalf("names: %q", names)
	}
	ms := func(y int, m time.Month, d, h int) int64 { return time.Date(y, m, d, h, 0, 0, 0, time.UTC).UnixMilli() }
	if c[0]["start"] != ms(2026, 11, 28, 0) || c[0]["end"] != ms(2026, 11, 30, 0) {
		t.Errorf("2400Z should be midnight at the end of the day: %v %v", c[0]["start"], c[0]["end"])
	}
	if c[1]["start"] != ms(2026, 12, 31, 0) {
		t.Errorf("Dec 31: %v", c[1]["start"])
	}
	if c[2]["end"].(int64)-c[2]["start"].(int64) != 2*3600*1000 {
		t.Error("a contest past midnight should run 2 hours")
	}
	if c[3]["start"] != nil {
		t.Error("times it can't read are left for the link")
	}
	s, e, ok := parseContestWhen("0000Z-0100Z, Jan 2", time.Date(2026, 12, 30, 0, 0, 0, 0, time.UTC))
	if !ok || s.Year() != 2027 || e.Sub(s) != time.Hour {
		t.Errorf("the nearest year: %v %v %v", s, e, ok)
	}
	if len(parseContestFeed("not xml", ref)) != 0 {
		t.Error("not xml")
	}
}

func TestContestsRouteCachesAndKeepsAnOldCopy(t *testing.T) {
	var hits atomic.Int32
	var fail atomic.Bool
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if fail.Load() {
			w.WriteHeader(503)
			return
		}
		w.Write([]byte(contestRSS))
	}))
	defer up.Close()
	s := NewServer(Config{ContestURL: up.URL})
	get := func(method string) (int, map[string]any, http.Header) {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(method, "/api/contests", nil))
		var body map[string]any
		json.Unmarshal(rec.Body.Bytes(), &body)
		return rec.Code, body, rec.Header()
	}
	code, body, h := get("GET")
	if code != 200 || body["source"] != "WA7BNM Contest Calendar" || len(body["contests"].([]any)) != 4 {
		t.Fatalf("first: %d %v", code, body)
	}
	if h.Get("Cache-Control") != "public, max-age=900" {
		t.Errorf("cache header: %q", h.Get("Cache-Control"))
	}
	get("GET")
	if hits.Load() != 1 {
		t.Errorf("fetched %d times within 6 hours", hits.Load())
	}
	fail.Store(true)
	s.clock.Advance(7 * time.Hour)
	code, body, _ = get("GET")
	if code != 200 || body["stale"] != true {
		t.Fatalf("the old copy should be kept when the calendar is down: %d %v", code, body)
	}
	if code, _, _ = get("POST"); code != 405 {
		t.Errorf("POST: %d", code)
	}
	empty := NewServer(Config{ContestURL: up.URL})
	rec := httptest.NewRecorder()
	empty.ServeHTTP(rec, httptest.NewRequest("GET", "/api/contests", nil))
	if rec.Code != 502 {
		t.Errorf("no copy and the calendar down: %d", rec.Code)
	}
}

// The Windows app has no chat of its own: it says where the chat is and accepts no messages.
func TestChatPointsToTheWebsite(t *testing.T) {
	s := NewServer(Config{})
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest("GET", "/api/chat?room=general&since=0", nil))
	var body map[string]any
	json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != 200 || body["available"] != false || body["web"] != "https://band-watch.ample.run/" || len(body["messages"].([]any)) != 0 {
		t.Fatalf("GET: %d %v", rec.Code, body)
	}
	rec = httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/chat", strings.NewReader(`{"room":"general","call":"M3VRV","text":"hi"}`))
	req.Header.Set("Content-Type", "application/json")
	s.ServeHTTP(rec, req)
	if rec.Code != 404 || !strings.Contains(rec.Body.String(), "web version") {
		t.Fatalf("POST: %d %s", rec.Code, rec.Body.String())
	}
}
