package main

// QRZ.com XML data service: sign in, look up callsigns, sign out.
// The password is sent once to QRZ to get a session key and is never stored.
// The browser only holds an opaque HttpOnly cookie; the QRZ key stays here.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/xml"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	qrzAgent      = "BandWatch-M3VRV-1.2"
	sessionTTL    = 24 * time.Hour
	sessionsMax   = 500
	lookupTTL     = time.Hour
	loginWindow   = 15 * time.Minute
	loginAttempts = 10
)

type QrzError struct {
	Status int
	Msg    string
}

func (e *QrzError) Error() string { return e.Msg }

type qrzSession struct {
	key, user, sub string
	t              time.Time
}
type qrzLookup struct {
	t    time.Time
	data map[string]any
}

type QRZ struct {
	mu       sync.Mutex
	url      string
	clock    *Clock
	client   *http.Client
	sessions map[string]*qrzSession
	order    []string // session ids, oldest first
	lookups  map[string]qrzLookup
	attempts map[string][]time.Time
}

func newQRZ(u string, c *Clock, client *http.Client) *QRZ {
	q := &QRZ{url: u, clock: c, client: client}
	q.Reset()
	return q
}

func (q *QRZ) Reset() {
	q.mu.Lock()
	q.sessions = map[string]*qrzSession{}
	q.order = nil
	q.lookups = map[string]qrzLookup{}
	q.attempts = map[string][]time.Time{}
	q.mu.Unlock()
}

// block returns the child elements of the first <tag>…</tag> as a flat map.
func block(data []byte, tag string) map[string]string {
	dec := xml.NewDecoder(strings.NewReader(string(data)))
	dec.Strict = false
	dec.Entity = xml.HTMLEntity
	depth := -1 // depth inside the wanted block
	var out map[string]string
	child := ""
	var text strings.Builder
	for {
		tok, err := dec.Token()
		if err != nil {
			return out
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if depth < 0 {
				if t.Name.Local == tag && out == nil {
					depth, out = 0, map[string]string{}
				}
				continue
			}
			depth++
			if depth == 1 {
				child = t.Name.Local
				text.Reset()
			}
		case xml.CharData:
			if depth == 1 {
				text.Write(t)
			}
		case xml.EndElement:
			if depth < 0 {
				continue
			}
			if depth == 0 {
				return out
			}
			if depth == 1 {
				out[child] = strings.TrimSpace(text.String())
			}
			depth--
		}
	}
}

func (q *QRZ) call(params url.Values) (session map[string]string, callsign map[string]string, err error) {
	params.Set("agent", qrzAgent)
	req, _ := http.NewRequest("GET", q.url+"?"+params.Encode(), nil)
	req.Header.Set("User-Agent", qrzAgent)
	client := *q.client
	client.Timeout = 15 * time.Second
	res, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, nil, &QrzError{502, "QRZ.com could not be reached"}
	}
	buf := new(strings.Builder)
	if _, err := ioCopyLimit(buf, res); err != nil {
		return nil, nil, err
	}
	data := []byte(buf.String())
	session = block(data, "Session")
	if session == nil {
		session = map[string]string{}
	}
	return session, block(data, "Callsign"), nil
}

func (q *QRZ) tooManyAttempts(ip string) bool {
	now := q.clock.Now()
	list := []time.Time{}
	for _, t := range q.attempts[ip] {
		if now.Sub(t) < loginWindow {
			list = append(list, t)
		}
	}
	list = append(list, now)
	q.attempts[ip] = list
	if len(q.attempts) > 5000 {
		for k := range q.attempts {
			if k != ip {
				delete(q.attempts, k)
				break
			}
		}
	}
	return len(list) > loginAttempts
}

func (q *QRZ) prune() {
	now := q.clock.Now()
	keep := q.order[:0]
	for _, sid := range q.order {
		if s, ok := q.sessions[sid]; ok && now.Sub(s.t) <= sessionTTL {
			keep = append(keep, sid)
		} else {
			delete(q.sessions, sid)
		}
	}
	q.order = keep
	for len(q.order) > sessionsMax {
		delete(q.sessions, q.order[0])
		q.order = q.order[1:]
	}
	for k, v := range q.lookups {
		if now.Sub(v.t) > lookupTTL {
			delete(q.lookups, k)
		}
	}
}

var nonSubscriber = regexp.MustCompile(`(?i)non-subscriber`)
var badLogin = regexp.MustCompile(`(?i)password|username|not found`)

func publicInfo(s *qrzSession) map[string]any {
	sub := s.sub != "" && !nonSubscriber.MatchString(s.sub)
	return map[string]any{"loggedIn": true, "user": s.user, "subscriber": sub, "subscription": s.sub}
}

type loginResult struct {
	sid  string
	info map[string]any
}

func (q *QRZ) Login(username, password, ip string) (*loginResult, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" || utf8.RuneCountInString(username) > 64 || utf8.RuneCountInString(password) > 128 {
		return nil, &QrzError{400, "Enter your QRZ username and password."}
	}
	q.mu.Lock()
	limited := q.tooManyAttempts(ip)
	q.mu.Unlock()
	if limited {
		return nil, &QrzError{429, "Too many sign-in attempts. Wait 15 minutes and try again."}
	}
	session, _, err := q.call(url.Values{"username": {username}, "password": {password}})
	if err != nil {
		return nil, err
	}
	if session["Key"] == "" {
		msg := session["Error"]
		if msg == "" || badLogin.MatchString(msg) {
			msg = "QRZ did not accept that username and password."
		}
		return nil, &QrzError{401, msg}
	}
	b := make([]byte, 24)
	rand.Read(b)
	sid := hex.EncodeToString(b)
	s := &qrzSession{key: session["Key"], user: strings.ToUpper(username), sub: session["SubExp"], t: q.clock.Now()}
	q.mu.Lock()
	q.prune()
	q.sessions[sid] = s
	q.order = append(q.order, sid)
	q.mu.Unlock()
	return &loginResult{sid, publicInfo(s)}, nil
}

func (q *QRZ) Status(sid string) map[string]any {
	q.mu.Lock()
	defer q.mu.Unlock()
	s := q.sessions[sid]
	if sid == "" || s == nil || q.clock.Now().Sub(s.t) > sessionTTL {
		return map[string]any{"loggedIn": false}
	}
	return publicInfo(s)
}

func (q *QRZ) Logout(sid string) {
	if sid == "" {
		return
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.logoutLocked(sid)
}

func (q *QRZ) logoutLocked(sid string) {
	delete(q.sessions, sid)
	for k := range q.lookups {
		if strings.HasPrefix(k, sid+"|") {
			delete(q.lookups, k)
		}
	}
}

var callChars = regexp.MustCompile(`^[A-Z0-9/]+$`)
var hasDigit = regexp.MustCompile(`\d`)
var sessionErr = regexp.MustCompile(`(?i)session|key`)
var notFound = regexp.MustCompile(`(?i)not found`)

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (q *QRZ) Lookup(sid, rawCall string) (map[string]any, error) {
	q.mu.Lock()
	s := q.sessions[sid]
	q.mu.Unlock()
	if sid == "" || s == nil {
		return nil, &QrzError{401, "Sign in to QRZ to look up callsigns here."}
	}
	call := strings.ToUpper(strings.TrimSpace(rawCall))
	if !hasDigit.MatchString(call) || len(call) > 20 || !callChars.MatchString(call) {
		return nil, &QrzError{400, "That doesn’t look like a callsign."}
	}
	cacheKey := sid + "|" + call
	q.mu.Lock()
	hit, ok := q.lookups[cacheKey]
	q.mu.Unlock()
	if ok && q.clock.Now().Sub(hit.t) < lookupTTL {
		return hit.data, nil
	}

	session, c, err := q.call(url.Values{"s": {s.key}, "callsign": {call}})
	if err != nil {
		return nil, err
	}
	if c == nil {
		e := session["Error"]
		switch {
		case sessionErr.MatchString(e):
			q.Logout(sid)
			return nil, &QrzError{401, "Your QRZ session has ended. Sign in again."}
		case notFound.MatchString(e):
			return nil, &QrzError{404, call + " was not found on QRZ."}
		case e == "":
			e = "QRZ returned no data."
		}
		return nil, &QrzError{502, e}
	}

	name := strings.TrimSpace(strings.Join(nonEmpty(c["fname"], c["name"]), " "))
	num := func(k string) any {
		if c[k] == "" {
			return nil
		}
		f, err := strconv.ParseFloat(c[k], 64)
		if err != nil {
			return nil
		}
		return f
	}
	country := c["country"]
	if country == "" {
		country = c["land"]
	}
	image := c["image"]
	if !strings.HasPrefix(image, "https://") {
		image = ""
	}
	var dst any
	if c["DST"] != "" {
		dst = strings.ToUpper(c["DST"]) == "Y"
	}
	data := map[string]any{
		"call":         firstNonEmpty(c["call"], call),
		"name":         nullable(name),
		"nickname":     nullable(c["nickname"]),
		"city":         nullable(c["addr2"]),
		"state":        nullable(c["state"]),
		"country":      nullable(country),
		"grid":         nullable(c["grid"]),
		"lat":          num("lat"),
		"lon":          num("lon"),
		"licenceClass": nullable(c["class"]),
		"cqZone":       nullable(c["cqzone"]),
		"ituZone":      nullable(c["ituzone"]),
		"qslManager":   nullable(c["qslmgr"]),
		"lotw":         c["lotw"] == "1",
		"eqsl":         c["eqsl"] == "1",
		"paperQsl":     c["mqsl"] == "1",
		"image":        nullable(image),
		"timeZone":     nullable(c["TimeZone"]),
		"gmtOffset":    num("GMTOffset"),
		"dst":          dst,
		"limited":      !publicInfo(s)["subscriber"].(bool),
		"message":      nullable(session["Message"]),
	}
	q.mu.Lock()
	q.lookups[cacheKey] = qrzLookup{q.clock.Now(), data}
	q.mu.Unlock()
	return data, nil
}

func nonEmpty(xs ...string) []string {
	out := []string{}
	for _, x := range xs {
		if x != "" {
			out = append(out, x)
		}
	}
	return out
}

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}

func ioCopyLimit(dst *strings.Builder, res *http.Response) (int64, error) {
	return io.Copy(dst, io.LimitReader(res.Body, 4<<20))
}
