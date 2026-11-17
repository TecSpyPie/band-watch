// Band Watch by M3vrv: the same web server as server.js, written in Go so it compiles to a
// single BandWatch.exe that needs nothing else installed. The web page is embedded in the program.
package main

import (
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"path"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed all:public
var embedded embed.FS

var version = "dev" // set at build time from package.json
var buildDate = ""  // set at build time: when this exe was built (UTC)
var startedAt = time.Now()

const (
	solarTTL = 15 * time.Minute
	xotaTTL  = 2 * time.Minute
	dxTTL    = time.Minute
	spotsTTL = 5 * time.Minute
	sunTTL   = 30 * time.Minute
	cacheMax = 200
)

// Config says where the feeds are and which extras are switched on.
type Config struct {
	NoaaURL      string // https://services.swpc.noaa.gov
	PskURL       string // https://retrieve.pskreporter.info/query
	QrzURL       string // https://xmldata.qrz.com/xml/current/
	QrzLogURL    string // https://logbook.qrz.com/api
	PotaURL      string // https://api.pota.app/spot/activator
	DxURL        string // https://www.hamqth.com/api/v2/spots
	UpdateURL    string // GitHub's latest-release API for Band Watch
	UpdateAssets string // where release files may come from (tests only; default Band Watch's GitHub releases)
	TestHooks    bool   // /api/test/reset and /api/test/advance
	Desktop      bool   // only answer to localhost, and allow /api/quit
	Quit         func() // called by /api/quit
}

func defaultConfig() Config {
	return Config{
		NoaaURL:   "https://services.swpc.noaa.gov",
		PskURL:    "https://retrieve.pskreporter.info/query",
		QrzURL:    "https://xmldata.qrz.com/xml/current/",
		QrzLogURL: "https://logbook.qrz.com/api",
		PotaURL:   "https://api.pota.app/spot/activator",
		DxURL:     "https://www.hamqth.com/api/v2/spots",
		UpdateURL: releasesAPI,
	}
}

/* ---------- Clock that tests can move forward ---------- */

type Clock struct{ offset atomic.Int64 }

func (c *Clock) Now() time.Time          { return time.Now().Add(time.Duration(c.offset.Load())) }
func (c *Clock) Advance(d time.Duration) { c.offset.Add(int64(d)) }
func (c *Clock) Reset()                  { c.offset.Store(0) }
func (c *Clock) Millis() int64           { return c.Now().UnixMilli() }

/* ---------- Cache: TTL, request coalescing, stale-on-error, size cap ---------- */

type cacheEntry struct {
	t    time.Time
	data map[string]any
}
type flight struct {
	done chan struct{}
	data map[string]any
	err  error
}
type Cache struct {
	mu       sync.Mutex
	clock    *Clock
	items    map[string]cacheEntry
	inflight map[string]*flight
}

func newCache(c *Clock) *Cache {
	return &Cache{clock: c, items: map[string]cacheEntry{}, inflight: map[string]*flight{}}
}

func (c *Cache) Clear() {
	c.mu.Lock()
	c.items = map[string]cacheEntry{}
	c.inflight = map[string]*flight{}
	c.mu.Unlock()
}

func (c *Cache) Get(key string, ttl time.Duration, load func() (map[string]any, error)) (map[string]any, error) {
	c.mu.Lock()
	hit, ok := c.items[key]
	if ok && c.clock.Now().Sub(hit.t) < ttl {
		c.mu.Unlock()
		return hit.data, nil
	}
	if f, busy := c.inflight[key]; busy {
		c.mu.Unlock()
		<-f.done
		return f.data, f.err
	}
	f := &flight{done: make(chan struct{})}
	c.inflight[key] = f
	c.mu.Unlock()

	data, err := load()

	c.mu.Lock()
	if err == nil {
		c.items[key] = cacheEntry{c.clock.Now(), data}
		for len(c.items) > cacheMax { // drop the oldest
			oldest, first := "", true
			for k, v := range c.items {
				if first || v.t.Before(c.items[oldest].t) {
					oldest, first = k, false
				}
			}
			delete(c.items, oldest)
		}
	} else if ok {
		stale := make(map[string]any, len(hit.data)+1)
		for k, v := range hit.data {
			stale[k] = v
		}
		stale["stale"] = true
		data, err = stale, nil
	}
	if c.inflight[key] == f {
		delete(c.inflight, key)
	}
	f.data, f.err = data, err
	close(f.done)
	c.mu.Unlock()
	return data, err
}

/* ---------- Server ---------- */

type Server struct {
	cfg    Config
	static fs.FS
	clock  *Clock
	cache  *Cache
	qrz    *QRZ
	qrzlog *QRZLog
	client *http.Client
	sdr    *sdrBridge
	// runInstaller starts a downloaded update (tests replace it).
	runInstaller func(path string) error
	// updatesAllowed: installing updates only happens in the desktop app on Windows.
	updatesAllowed bool
}

func NewServer(cfg Config) *Server {
	static, err := fs.Sub(embedded, "public")
	if err != nil {
		panic(err)
	}
	clock := &Clock{}
	client := &http.Client{Timeout: 30 * time.Second}
	return &Server{cfg: cfg, static: static, clock: clock, cache: newCache(clock), qrz: newQRZ(cfg.QrzURL, clock, client), qrzlog: newQRZLog(cfg.QrzLogURL, clock, client), client: client, sdr: newSdrBridge(),
		runInstaller: startInstaller, updatesAllowed: cfg.Desktop && runtime.GOOS == "windows"}
}

func (s *Server) ResetAll() {
	s.cache.Clear()
	s.qrz.Reset()
	s.qrzlog.Reset()
	s.clock.Reset()
}

var securityHeaders = map[string]string{
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy":        "strict-origin-when-cross-origin",
}

func sendJSON(w http.ResponseWriter, code int, body any, extra map[string]string) {
	h := w.Header()
	for k, v := range securityHeaders {
		h.Set(k, v)
	}
	h.Set("Content-Type", "application/json")
	h.Set("Cache-Control", "no-store")
	for k, v := range extra {
		h.Set(k, v)
	}
	w.WriteHeader(code)
	b, _ := json.Marshal(body)
	w.Write(b)
}

func errJSON(msg string) map[string]any { return map[string]any{"error": msg} }

var localHost = regexp.MustCompile(`^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$`)
var gridRe = regexp.MustCompile(`^[A-R]{2}\d{2}$`)

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// The desktop app only answers to this PC, which also stops other web sites reaching it by DNS tricks.
	if s.cfg.Desktop && !localHost.MatchString(r.Host) {
		sendJSON(w, 421, errJSON("Band Watch only answers on localhost."), nil)
		return
	}
	p := r.URL.Path
	if strings.HasPrefix(p, "/api/qrz/") {
		s.handleQRZ(w, r)
		return
	}
	if p == "/api/sdr" || strings.HasPrefix(p, "/api/sdr/") {
		s.handleSdr(w, r)
		return
	}
	if r.Method == http.MethodPost {
		switch {
		case s.cfg.TestHooks && p == "/api/test/reset":
			s.ResetAll()
			sendJSON(w, 200, map[string]any{"ok": true}, nil)
			return
		case s.cfg.TestHooks && p == "/api/test/advance":
			ms, _ := strconv.ParseInt(r.URL.Query().Get("ms"), 10, 64)
			s.clock.Advance(time.Duration(ms) * time.Millisecond)
			sendJSON(w, 200, map[string]any{"ok": true}, nil)
			return
		case p == "/api/update/install":
			s.handleUpdateInstall(w, r)
			return
		case s.cfg.Desktop && p == "/api/quit":
			// JSON only, so another web site can't post it without the browser asking first.
			if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
				sendJSON(w, 415, errJSON("Expected JSON."), nil)
				return
			}
			sendJSON(w, 200, map[string]any{"ok": true}, nil)
			if s.cfg.Quit != nil {
				go func() { time.Sleep(200 * time.Millisecond); s.cfg.Quit() }()
			}
			return
		}
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		sendJSON(w, 405, errJSON("method not allowed"), nil)
		return
	}
	var data map[string]any
	var err error
	switch {
	case p == "/healthz":
		sendJSON(w, 200, map[string]any{"ok": true, "version": version, "desktop": s.cfg.Desktop,
			"build": map[string]any{"date": buildDate, "server": "BandWatch.exe", "runtime": runtime.Version(), "platform": runtime.GOOS + "/" + runtime.GOARCH, "started": startedAt.UTC().Format(time.RFC3339)}}, nil)
		return
	case p == "/api/solar":
		data, err = s.getSolar()
	case p == "/api/update":
		s.handleUpdateCheck(w)
		return
	case p == "/api/xota":
		data, err = s.getXota()
	case p == "/api/dx":
		data, err = s.getDx()
	case p == "/api/sun":
		data, err = s.getSun()
	case p == "/api/spots":
		grid := strings.ToUpper(r.URL.Query().Get("grid"))
		if len(grid) > 4 {
			grid = grid[:4]
		}
		if !gridRe.MatchString(grid) {
			sendJSON(w, 400, errJSON("grid must look like IO93"), nil)
			return
		}
		data, err = s.getSpots(grid)
	case strings.HasPrefix(p, "/api/"):
		sendJSON(w, 404, errJSON("not found"), nil)
		return
	default:
		s.sendStatic(w, r, p)
		return
	}
	if err != nil {
		log.Printf("%s: %v", p, err)
		sendJSON(w, 502, errJSON("upstream feed unavailable"), nil)
		return
	}
	sendJSON(w, 200, data, nil)
}

var mimeTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".svg":         "image/svg+xml",
	".json":        "application/json",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".ico":         "image/x-icon",
	".webmanifest": "application/manifest+json",
}

// Pages served without their .html ending, and files that must be checked for updates on every visit.
var pages = map[string]string{"": "index.html", "install": "install.html", "decodes": "decodes.html"}
var noCache = map[string]bool{"index.html": true, "install.html": true, "decodes.html": true, "sw.js": true, "manifest.webmanifest": true}

func (s *Server) sendStatic(w http.ResponseWriter, r *http.Request, p string) {
	rel := strings.TrimPrefix(p, "/")
	if page, ok := pages[rel]; ok {
		rel = page
	}
	if !fs.ValidPath(rel) || path.Clean(rel) != rel {
		sendJSON(w, 404, errJSON("not found"), nil)
		return
	}
	buf, err := fs.ReadFile(s.static, rel)
	if err != nil {
		sendJSON(w, 404, errJSON("not found"), nil)
		return
	}
	ext := path.Ext(rel)
	typ := mimeTypes[ext]
	if typ == "" {
		if typ = mime.TypeByExtension(ext); typ == "" {
			typ = "application/octet-stream"
		}
	}
	h := w.Header()
	for k, v := range securityHeaders {
		h.Set(k, v)
	}
	h.Set("Content-Type", typ)
	if noCache[rel] {
		h.Set("Cache-Control", "no-cache")
	} else {
		h.Set("Cache-Control", "public, max-age=300")
	}
	w.WriteHeader(200)
	if r.Method != http.MethodHead {
		w.Write(buf)
	}
}

/* ---------- QRZ routes ---------- */

const cookieName = "bw_qrz"

var localCookieHost = regexp.MustCompile(`^(localhost|127\.0\.0\.1)(:\d+)?$`)

func sessionCookie(r *http.Request, value string, maxAge int) string {
	c := cookieName + "=" + value + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + strconv.Itoa(maxAge)
	if !localCookieHost.MatchString(r.Host) {
		c += "; Secure"
	}
	return c
}

func readSessionCookie(r *http.Request) string {
	for _, part := range strings.Split(r.Header.Get("Cookie"), ";") {
		k, v, _ := strings.Cut(strings.TrimSpace(part), "=")
		if k == cookieName {
			return v
		}
	}
	return ""
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); xff != "" {
		return xff
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

var jsonType = regexp.MustCompile(`(?i)^application/json\b`)

// readJSON reads a small JSON body. Only JSON is accepted, which also blocks cross-site form posts.
func readJSON(r *http.Request, limit int64) (map[string]any, error) {
	if !jsonType.MatchString(r.Header.Get("Content-Type")) {
		return nil, &QrzError{415, "Expected JSON."}
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		io.Copy(io.Discard, r.Body) // drain so we can still answer
		return nil, &QrzError{413, "Request too large."}
	}
	out := map[string]any{}
	if len(strings.TrimSpace(string(body))) == 0 {
		return out, nil
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, &QrzError{400, "Invalid JSON."}
	}
	return out, nil
}

func asString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

func (s *Server) handleQRZ(w http.ResponseWriter, r *http.Request) {
	sid := readSessionCookie(r)
	route := r.Method + " " + r.URL.Path
	var err error
	switch route {
	case "GET /api/qrz/status":
		sendJSON(w, 200, s.qrz.Status(sid), nil)
		return
	case "POST /api/qrz/login":
		var body map[string]any
		if body, err = readJSON(r, 4096); err == nil {
			var res *loginResult
			if res, err = s.qrz.Login(asString(body["username"]), asString(body["password"]), clientIP(r)); err == nil {
				if sid != "" {
					s.qrz.Logout(sid)
				}
				sendJSON(w, 200, res.info, map[string]string{"Set-Cookie": sessionCookie(r, res.sid, 86400)})
				return
			}
		}
	case "POST /api/qrz/logout":
		s.qrz.Logout(sid)
		sendJSON(w, 200, map[string]any{"loggedIn": false}, map[string]string{"Set-Cookie": sessionCookie(r, "", 0)})
		return
	case "GET /api/qrz/lookup":
		var data map[string]any
		if data, err = s.qrz.Lookup(sid, r.URL.Query().Get("call")); err == nil {
			sendJSON(w, 200, data, nil)
			return
		}
	case "POST /api/qrz/logbook":
		var body map[string]any
		if body, err = readJSON(r, 8192); err == nil {
			var data map[string]any
			if data, err = s.qrzlog.Logbook(asString(body["key"]), asString(body["action"]), asString(body["adif"]), clientIP(r)); err == nil {
				sendJSON(w, 200, data, nil)
				return
			}
		}
	default:
		if r.URL.Path == "/api/qrz/login" || r.URL.Path == "/api/qrz/logout" || r.URL.Path == "/api/qrz/logbook" {
			sendJSON(w, 405, errJSON("method not allowed"), nil)
		} else {
			sendJSON(w, 404, errJSON("not found"), nil)
		}
		return
	}
	var qe *QrzError
	if errors.As(err, &qe) {
		sendJSON(w, qe.Status, errJSON(qe.Msg), nil)
		return
	}
	log.Printf("%s: %v", r.URL.Path, err)
	sendJSON(w, 502, errJSON("QRZ.com could not be reached."), nil)
}
