package main

// QRZ Logbook: send contacts to the user's own QRZ logbook.
// The browser keeps the user's QRZ Logbook API key and sends it with each request; it is passed
// straight to QRZ and never stored or logged here. QRZ's API needs a QRZ subscription to insert.

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	logWindow = time.Minute
	logMax    = 120 // requests per address per minute
)

type QRZLog struct {
	mu     sync.Mutex
	url    string
	clock  *Clock
	client *http.Client
	calls  map[string][]time.Time
}

func newQRZLog(u string, c *Clock, client *http.Client) *QRZLog {
	l := &QRZLog{url: u, clock: c, client: client}
	l.Reset()
	return l
}

func (l *QRZLog) Reset() {
	l.mu.Lock()
	l.calls = map[string][]time.Time{}
	l.mu.Unlock()
}

func (l *QRZLog) tooMany(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.clock.Now()
	list := []time.Time{}
	for _, t := range l.calls[ip] {
		if now.Sub(t) < logWindow {
			list = append(list, t)
		}
	}
	list = append(list, now)
	l.calls[ip] = list
	if len(l.calls) > 5000 {
		for k := range l.calls {
			if k != ip {
				delete(l.calls, k)
				break
			}
		}
	}
	return len(list) > logMax
}

var (
	logKeyRe    = regexp.MustCompile(`^[A-Z0-9-]{8,64}$`)
	adifCallRe  = regexp.MustCompile(`(?i)<call:\d+>`)
	adifEorRe   = regexp.MustCompile(`(?i)<eor>`)
	logFieldRe  = regexp.MustCompile(`(?i)^[A-Z_]{1,40}$`)
	logSkipRe   = regexp.MustCompile(`(?i)^(RESULT|REASON|KEY)$`)
	duplicateRe = regexp.MustCompile(`(?i)duplicate`)
	authRe      = regexp.MustCompile(`(?i)invalid api key|access key|not authorized|no such key`)
)

// Logbook asks QRZ about a key (STATUS) or adds one ADIF record (INSERT).
func (l *QRZLog) Logbook(rawKey, rawAction, adif, ip string) (map[string]any, error) {
	key := strings.ToUpper(strings.TrimSpace(rawKey))
	action := strings.ToUpper(strings.TrimSpace(rawAction))
	if !logKeyRe.MatchString(key) {
		return nil, &QrzError{400, "That doesn’t look like a QRZ Logbook API key. It looks like ABCD-1234-EF56-7890."}
	}
	if action != "STATUS" && action != "INSERT" {
		return nil, &QrzError{400, "Unknown logbook action."}
	}
	if action == "INSERT" && (adif == "" || len(adif) > 4000 || !adifCallRe.MatchString(adif) || !adifEorRe.MatchString(adif)) {
		return nil, &QrzError{400, "That contact couldn’t be read."}
	}
	if l.tooMany(ip) {
		return nil, &QrzError{429, "Too many QRZ Logbook requests. Wait a minute and try again."}
	}
	form := url.Values{"KEY": {key}, "ACTION": {action}}
	if action == "INSERT" {
		form.Set("ADIF", adif)
	}
	req, _ := http.NewRequest("POST", l.url, strings.NewReader(form.Encode()))
	req.Header.Set("User-Agent", qrzAgent)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := *l.client
	client.Timeout = 20 * time.Second
	unreachable := &QrzError{502, "QRZ Logbook could not be reached. Try again in a minute."}
	res, err := client.Do(req)
	if err != nil {
		return nil, unreachable
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, unreachable
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 20000))
	if err != nil {
		return nil, unreachable
	}
	return parseLogbookReply(string(body)), nil
}

func cut(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// parseLogbookReply reads QRZ's name=value pairs joined with &.
func parseLogbookReply(text string) map[string]any {
	p, _ := url.ParseQuery(strings.TrimSpace(text))
	get := func(k string) string {
		if v, ok := p[k]; ok && len(v) > 0 {
			return v[0]
		}
		return ""
	}
	result := strings.ToUpper(get("RESULT"))
	reason := cut(get("REASON"), 300)
	info := map[string]any{}
	keys := []string{}
	for k := range p {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if len(info) >= 30 || logSkipRe.MatchString(k) || !logFieldRe.MatchString(k) {
			continue
		}
		info[strings.ToUpper(k)] = cut(p[k][0], 200)
	}
	out := map[string]any{
		"ok":        result == "OK" || result == "REPLACE",
		"result":    result,
		"reason":    reason,
		"duplicate": duplicateRe.MatchString(reason),
		"auth":      result == "AUTH" || authRe.MatchString(reason),
		"logid":     nil,
		"count":     nil,
		"info":      info,
	}
	if result == "" {
		out["result"] = "FAIL"
		if reason == "" {
			out["reason"] = "QRZ gave an answer HamShack didn’t understand."
		}
	}
	if id := get("LOGID"); id != "" {
		out["logid"] = id
	} else if id := get("LOGIDS"); id != "" {
		out["logid"] = id
	}
	if _, ok := p["COUNT"]; ok {
		if n, err := strconv.ParseFloat(get("COUNT"), 64); err == nil {
			out["count"] = n
		}
	}
	return out
}
