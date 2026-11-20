package main

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

func userAgent() string { return "BandWatch-M3VRV/" + version + " (amateur radio propagation monitor)" }

func (s *Server) fetch(rawURL string, timeout time.Duration) ([]byte, error) {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent())
	client := *s.client
	client.Timeout = timeout
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		host := rawURL
		if u, e := url.Parse(rawURL); e == nil {
			host = u.Host
		}
		return nil, fmt.Errorf("%s answered %d", host, res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, 32<<20))
}

func (s *Server) fetchJSON(rawURL string, timeout time.Duration, into any) error {
	b, err := s.fetch(rawURL, timeout)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, into)
}

func (s *Server) noaa(p string) string { return strings.TrimSuffix(s.cfg.NoaaURL, "/") + "/" + p }

/* ---------- Numbers in NOAA's JSON may be numbers, strings or null ---------- */

func numOf(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, !math.IsNaN(x) && !math.IsInf(x, 0)
	case string:
		if strings.TrimSpace(x) == "" {
			return 0, false
		}
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		return f, err == nil && !math.IsNaN(f) && !math.IsInf(f, 0)
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	}
	return 0, false
}

// numOrNil gives a JSON number or null.
func numOrNil(v any) any {
	if f, ok := numOf(v); ok {
		return f
	}
	return nil
}

func strOf(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return asString(v)
}

// latestByTime is the most recent record with a usable value (NOAA arrays aren't guaranteed to be sorted).
func latestByTime(rows []map[string]any, field string) map[string]any {
	var best map[string]any
	for _, r := range rows {
		if r == nil {
			continue
		}
		if _, ok := numOf(r[field]); !ok {
			continue
		}
		if best == nil || strOf(r["time_tag"]) > strOf(best["time_tag"]) {
			best = r
		}
	}
	return best
}

func jsRound(f float64) float64 { return math.Floor(f + 0.5) }

/* ---------- Solar flux and Kp ---------- */

func (s *Server) getSolar() (map[string]any, error) {
	return s.cache.Get("solar", solarTTL, func() (map[string]any, error) {
		var flux, kp []map[string]any
		errs := make(chan error, 2)
		go func() { errs <- s.fetchJSON(s.noaa("json/f107_cm_flux.json"), 20*time.Second, &flux) }()
		go func() { errs <- s.fetchJSON(s.noaa("json/planetary_k_index_1m.json"), 20*time.Second, &kp) }()
		for i := 0; i < 2; i++ {
			if err := <-errs; err != nil {
				return nil, err
			}
		}
		f := latestByTime(flux, "flux")
		k := latestByTime(kp, "kp_index")
		if f == nil || k == nil {
			return nil, errors.New("NOAA returned no usable data")
		}
		fv, _ := numOf(f["flux"])
		kv, _ := numOf(k["kp_index"])
		return map[string]any{"sfi": jsRound(fv), "kp": jsRound(kv), "at": s.clock.Millis()}, nil
	})
}

/* ---------- PSK Reporter spots ---------- */

// Spot is one path: the far station (C), the station in our grid (L), and how they were heard.
type Spot struct {
	C   string   `json:"c"`
	L   string   `json:"l"`
	G   string   `json:"g"`
	Lat float64  `json:"lat"`
	Lon float64  `json:"lon"`
	Fq  float64  `json:"fq"`
	M   string   `json:"m"`
	SNR *float64 `json:"snr"`
	Ts  int64    `json:"ts"`
	Dir string   `json:"dir"`
}

func round(f float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(f*p) / p
}

// locatorToLatLon gives the centre of a 4- or 6-character Maidenhead square (longer locators are cut to 6).
func locatorToLatLon(loc string) (lat, lon float64, ok bool) {
	g := strings.ToUpper(loc)
	isAR := func(c byte) bool { return c >= 'A' && c <= 'R' }
	isAX := func(c byte) bool { return c >= 'A' && c <= 'X' }
	isD := func(c byte) bool { return c >= '0' && c <= '9' }
	if len(g) < 4 || !isAR(g[0]) || !isAR(g[1]) || !isD(g[2]) || !isD(g[3]) {
		return 0, 0, false
	}
	six := len(g) >= 6 && isAX(g[4]) && isAX(g[5])
	lon = float64(g[0]-'A')*20 - 180 + float64(g[2]-'0')*2
	lat = float64(g[1]-'A')*10 - 90 + float64(g[3]-'0')
	if six {
		lon += float64(g[4]-'A')*(5.0/60) + 2.5/60
		lat += float64(g[5]-'A')*(2.5/60) + 1.25/60
	} else {
		lon += 1
		lat += 0.5
	}
	return round(lat, 3), round(lon, 3), true
}

// parsePskXML turns PSK Reporter XML into one spot per path (remote station, local station, MHz), newest kept.
func parsePskXML(data []byte, grid string) []Spot {
	dec := xml.NewDecoder(strings.NewReader(string(data)))
	dec.Strict = false
	dec.AutoClose = xml.HTMLAutoClose
	dec.Entity = xml.HTMLEntity
	out := []Spot{}
	index := map[string]int{}
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		el, ok := tok.(xml.StartElement)
		if !ok || el.Name.Local != "receptionReport" {
			continue
		}
		a := map[string]string{}
		for _, at := range el.Attr {
			a[at.Name.Local] = at.Value
		}
		senderInGrid := strings.HasPrefix(strings.ToUpper(a["senderLocator"]), grid)
		call, local, remoteLoc, dir := a["senderCallsign"], a["receiverCallsign"], a["senderLocator"], "heard in your grid"
		if senderInGrid {
			call, local, remoteLoc, dir = a["receiverCallsign"], a["senderCallsign"], a["receiverLocator"], "hears your grid"
		}
		lat, lon, okPos := locatorToLatLon(remoteLoc)
		hz, errF := strconv.ParseFloat(a["frequency"], 64)
		secs, errT := strconv.ParseFloat(a["flowStartSeconds"], 64)
		if call == "" || !okPos || errF != nil || !(hz > 0) || errT != nil || !(secs > 0) {
			continue
		}
		fq := hz / 1e6
		ts := int64(secs * 1000)
		key := call + "|" + local + "|" + strconv.Itoa(int(math.Floor(fq)))
		if i, seen := index[key]; seen && out[i].Ts >= ts {
			continue
		}
		var snr *float64
		if v, err := strconv.ParseFloat(strings.TrimSpace(a["sNR"]), 64); err == nil && !math.IsNaN(v) && !math.IsInf(v, 0) {
			snr = &v
		}
		g := remoteLoc
		if len(g) > 6 {
			g = g[:6]
		}
		sp := Spot{C: call, L: local, G: g, Lat: lat, Lon: lon, Fq: round(fq, 6), M: a["mode"], SNR: snr, Ts: ts, Dir: dir}
		if i, seen := index[key]; seen {
			out[i] = sp
		} else {
			index[key] = len(out)
			out = append(out, sp)
		}
	}
	return out
}

func (s *Server) getSpots(grid string) (map[string]any, error) {
	return s.cache.Get("spots:"+grid, spotsTTL, func() (map[string]any, error) {
		q := url.Values{}
		q.Set("modify", "grid")
		q.Set("callsign", grid)
		q.Set("flowStartSeconds", "-1800")
		q.Set("rronly", "1")
		q.Set("noactive", "1")
		q.Set("rptlimit", "3000")
		b, err := s.fetch(s.cfg.PskURL+"?"+q.Encode(), 30*time.Second)
		if err != nil {
			return nil, err
		}
		return map[string]any{"grid": grid, "spots": parsePskXML(b, grid), "at": s.clock.Millis()}, nil
	})
}

/* ---------- Reports of your own signal (Antenna A/B) ---------- */

// PSK Reporter's developer page (pskreporter.info/pskdev.html) says: retrieve no more often than once every
// five minutes; flowStartSeconds is a negative lookback of at most 24 hours; give appcontact so the author can
// reach the app's maker (we send the project's public GitHub address, never a person's email); rptlimit caps the
// rows; rronly and noactive leave out monitor lists; and they may block anyone who loads their system. So:
// one upstream call per callsign per 5 minutes (shared by concurrent requests, stale if a refresh fails),
// always for the full 24 hours, and the browser's mins only trims our answer.
const (
	myReportsTTL     = spotsTTL
	myReportsMaxMins = 1440
	myReportsLimit   = 3000
	pskContact       = "https://github.com/TecSpyPie/band-watch"
)

// MyReport is one FT8 or FT4 reception report of the user's own callsign.
type MyReport struct {
	C   string  `json:"c"`
	G   string  `json:"g"`
	Lat float64 `json:"lat"`
	Lon float64 `json:"lon"`
	Fq  float64 `json:"fq"`
	M   string  `json:"m"`
	SNR float64 `json:"snr"`
	Ts  int64   `json:"ts"`
}

// parseMyReportsXML gives the FT8 and FT4 reports a station made of call, oldest first. Rows without a
// receiver, locator, frequency, time or SNR are skipped.
func parseMyReportsXML(data []byte, call string) []MyReport {
	dec := xml.NewDecoder(strings.NewReader(string(data)))
	dec.Strict = false
	dec.AutoClose = xml.HTMLAutoClose
	dec.Entity = xml.HTMLEntity
	out := []MyReport{}
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		el, ok := tok.(xml.StartElement)
		if !ok || el.Name.Local != "receptionReport" {
			continue
		}
		a := map[string]string{}
		for _, at := range el.Attr {
			a[at.Name.Local] = at.Value
		}
		mode := strings.ToUpper(a["mode"])
		if (mode != "FT8" && mode != "FT4") || strings.ToUpper(a["senderCallsign"]) != call {
			continue
		}
		rx, loc := a["receiverCallsign"], a["receiverLocator"]
		lat, lon, okPos := locatorToLatLon(loc)
		hz, errF := strconv.ParseFloat(a["frequency"], 64)
		secs, errT := strconv.ParseFloat(a["flowStartSeconds"], 64)
		snr, errS := strconv.ParseFloat(strings.TrimSpace(a["sNR"]), 64)
		if rx == "" || !okPos || errF != nil || !(hz > 0) || errT != nil || !(secs > 0) || errS != nil || math.IsNaN(snr) || math.IsInf(snr, 0) {
			continue
		}
		g := loc
		if len(g) > 6 {
			g = g[:6]
		}
		out = append(out, MyReport{C: rx, G: g, Lat: lat, Lon: lon, Fq: round(hz/1e6, 6), M: mode, SNR: snr, Ts: int64(secs * 1000)})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Ts < out[j].Ts })
	if len(out) > myReportsLimit {
		out = out[len(out)-myReportsLimit:]
	}
	return out
}

func (s *Server) getMyReports(call string) (map[string]any, error) {
	return s.cache.Get("myreports:"+call, myReportsTTL, func() (map[string]any, error) {
		q := url.Values{}
		q.Set("senderCallsign", call)
		q.Set("flowStartSeconds", strconv.Itoa(-myReportsMaxMins*60))
		q.Set("rronly", "1")
		q.Set("noactive", "1")
		q.Set("rptlimit", strconv.Itoa(myReportsLimit))
		q.Set("appcontact", pskContact)
		b, err := s.fetch(s.cfg.PskURL+"?"+q.Encode(), 30*time.Second)
		if err != nil {
			return nil, err
		}
		return map[string]any{"call": call, "reports": parseMyReportsXML(b, call), "at": s.clock.Millis()}, nil
	})
}

// myReportsAnswer trims the cached 24 hours to the last mins minutes.
func (s *Server) myReportsAnswer(data map[string]any, mins int) map[string]any {
	cutoff := s.clock.Millis() - int64(mins)*60000
	all, _ := data["reports"].([]MyReport)
	kept := make([]MyReport, 0, len(all))
	for _, r := range all {
		if r.Ts >= cutoff {
			kept = append(kept, r)
		}
	}
	out := make(map[string]any, len(data)+1)
	for k, v := range data {
		out[k] = v
	}
	out["mins"] = mins
	out["reports"] = kept
	return out
}

/* ---------- Sunspots and space weather ---------- */

func (s *Server) getSun() (map[string]any, error) {
	return s.cache.Get("sun", sunTTL, func() (map[string]any, error) {
		type result struct {
			name string
			data any
			err  error
		}
		paths := map[string]string{
			"regions": "json/solar_regions.json",
			"ssn":     "json/solar-cycle/swpc_observed_ssn.json",
			"flares":  "json/goes/primary/xray-flares-latest.json",
			"scales":  "products/noaa-scales.json",
			"wind":    "products/summary/solar-wind-speed.json",
		}
		ch := make(chan result, len(paths))
		for name, p := range paths {
			go func(name, p string) {
				var v any
				err := s.fetchJSON(s.noaa(p), 25*time.Second, &v)
				ch <- result{name, v, err}
			}(name, p)
		}
		got := map[string]any{}
		for range paths {
			r := <-ch
			if r.err != nil {
				if r.name == "regions" {
					return nil, r.err
				}
				continue // the rest is best effort
			}
			got[r.name] = r.data
		}
		return summariseSun(got, s.clock.Millis())
	})
}

func rows(v any) []map[string]any {
	list, _ := v.([]any)
	out := make([]map[string]any, 0, len(list))
	for _, x := range list {
		if m, ok := x.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func intOr0(v any) float64 {
	f, _ := numOf(v)
	return f
}

func summariseSun(got map[string]any, at int64) (map[string]any, error) {
	regions := rows(got["regions"])
	if len(regions) == 0 {
		return nil, errors.New("NOAA returned no sunspot regions")
	}
	date := ""
	for _, r := range regions {
		if d := strOf(r["observed_date"]); d > date {
			date = d
		}
	}
	today := []map[string]any{}
	for _, r := range regions {
		if strOf(r["observed_date"]) != date {
			continue
		}
		if _, ok := numOf(r["latitude"]); !ok {
			continue
		}
		if _, ok := numOf(r["longitude"]); !ok {
			continue
		}
		strOrNil := func(k string) any {
			if v := strOf(r[k]); v != "" {
				return v
			}
			return nil
		}
		today = append(today, map[string]any{
			"region":    numOrNil(r["region"]),
			"lat":       numOrNil(r["latitude"]),
			"lon":       numOrNil(r["longitude"]),
			"location":  strOf(r["location"]),
			"area":      numOrNil(r["area"]),
			"spots":     numOrNil(r["number_spots"]),
			"spotClass": strOrNil("spot_class"),
			"magClass":  strOrNil("mag_class"),
			"flares":    map[string]any{"c": intOr0(r["c_xray_events"]), "m": intOr0(r["m_xray_events"]), "x": intOr0(r["x_xray_events"])},
			"prob":      map[string]any{"c": numOrNil(r["c_flare_probability"]), "m": numOrNil(r["m_flare_probability"]), "x": numOrNil(r["x_flare_probability"])},
			"first":     strOrNil("first_date"),
		})
	}
	sort.SliceStable(today, func(i, j int) bool {
		ai, aj := intOr0(today[i]["area"]), intOr0(today[j]["area"])
		if ai != aj {
			return ai > aj
		}
		return intOr0(today[i]["region"]) < intOr0(today[j]["region"])
	})

	out := map[string]any{"date": date, "regions": today, "ssn": nil, "ssnDate": nil, "xray": nil, "scales": nil, "wind": nil, "at": at}
	var last map[string]any
	for _, r := range rows(got["ssn"]) {
		if _, ok := numOf(r["swpc_ssn"]); ok && (last == nil || strOf(r["Obsdate"]) > strOf(last["Obsdate"])) {
			last = r
		}
	}
	if last != nil {
		out["ssn"] = numOrNil(last["swpc_ssn"])
		d := strOf(last["Obsdate"])
		if len(d) > 10 {
			d = d[:10]
		}
		out["ssnDate"] = d
	}
	if f := rows(got["flares"]); len(f) > 0 {
		nz := func(k string) any {
			if v := strOf(f[0][k]); v != "" {
				return v
			}
			return nil
		}
		out["xray"] = map[string]any{"now": nz("current_class"), "flare": nz("max_class"), "flareAt": nz("max_time")}
	}
	if sc, ok := got["scales"].(map[string]any); ok {
		if now, ok := sc["0"].(map[string]any); ok {
			level := func(k string) string {
				if m, ok := now[k].(map[string]any); ok && m["Scale"] != nil {
					return strOf(m["Scale"])
				}
				return "0"
			}
			out["scales"] = map[string]any{"R": level("R"), "S": level("S"), "G": level("G")}
		}
	}
	if w := rows(got["wind"]); len(w) > 0 {
		out["wind"] = numOrNil(w[0]["proton_speed"])
	}
	return out, nil
}

/* ---------- POTA activators ---------- */
// SOTA spots are not used: SOTA's API terms don't allow AI-written software without their approval.

var xotaCallRe = regexp.MustCompile(`^[A-Z0-9/]{3,20}$`)
var zoneRe = regexp.MustCompile(`([zZ]|[+-]\d\d:?\d\d)$`)

// utcTime reads "2026-11-17T02:50:00" (UTC without a zone) or a time with a zone, as an ISO string.
func utcTime(v any) string {
	s := strings.TrimSpace(strOf(v))
	if s == "" {
		return ""
	}
	if !zoneRe.MatchString(s) {
		s = strings.Replace(s, " ", "T", 1) + "Z"
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04Z07:00"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC().Format("2006-01-02T15:04:05.000Z")
		}
	}
	return ""
}

func clip(v any, max int) string {
	s := strings.TrimSpace(strOf(v))
	if len(s) > max {
		s = s[:max]
	}
	return s
}

func potaSpot(r map[string]any) map[string]any {
	lat, lon := numOrNil(r["latitude"]), numOrNil(r["longitude"])
	if lat == nil || lon == nil {
		lat, lon = nil, nil
	}
	name := clip(r["parkName"], 120)
	if name == "" {
		name = clip(r["name"], 120)
	}
	grid := clip(r["grid6"], 8)
	if grid == "" {
		grid = clip(r["grid4"], 8)
	}
	return map[string]any{
		"src": "pota", "call": strings.ToUpper(clip(r["activator"], 20)), "kHz": numOrNil(r["frequency"]),
		"mode": strings.ToUpper(clip(r["mode"], 12)), "ref": clip(r["reference"], 20), "name": name,
		"loc": clip(r["locationDesc"], 40), "grid": grid, "lat": lat, "lon": lon,
		"time": utcTime(r["spotTime"]), "by": strings.ToUpper(clip(r["spotter"], 20)), "note": clip(r["comments"], 200),
	}
}

func (s *Server) getXota() (map[string]any, error) {
	return s.cache.Get("xota", xotaTTL, func() (map[string]any, error) {
		type result struct {
			spots []map[string]any
			err   error
		}
		load := func(u string, fn func(map[string]any) map[string]any) result {
			var rows []any
			if err := s.fetchJSON(u, 20*time.Second, &rows); err != nil {
				return result{err: err}
			}
			out := []map[string]any{}
			for _, row := range rows {
				if m, ok := row.(map[string]any); ok {
					out = append(out, fn(m))
				}
			}
			return result{spots: out}
		}
		pota := load(s.cfg.PotaURL, potaSpot)
		if pota.err != nil {
			return nil, pota.err
		}
		failed := []string{}
		spots := []map[string]any{}
		for _, x := range pota.spots {
			k, ok := x["kHz"].(float64)
			if !ok || k <= 100 || k >= 1.3e6 || !xotaCallRe.MatchString(x["call"].(string)) {
				continue
			}
			spots = append(spots, x)
		}
		sort.SliceStable(spots, func(i, j int) bool { return spots[i]["time"].(string) > spots[j]["time"].(string) })
		if len(spots) > 400 {
			spots = spots[:400]
		}
		return map[string]any{"spots": spots, "at": s.clock.Millis(), "failed": failed}, nil
	})
}
