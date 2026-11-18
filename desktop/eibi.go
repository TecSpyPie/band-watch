package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

/* ---------- EiBi shortwave schedule ----------
   eibispace.de, by Eike Bierwirth. Its README: "any person is absolutely free to download, use, copy,
   or distribute these files or to use them within third-party software." The files are passed on as
   published (converted from Latin-1); the page reads them with public/js/eibi-data.js.
   Plain http: the site's https certificate has expired. */

const eibiTTL = 12 * time.Hour

// eibiSeason is EiBi's season for a time: A (summer, from the last Sunday of March) or B (winter,
// from the last Sunday of October), plus the year, e.g. B26 for winter 2026/27.
func eibiSeason(t time.Time) string {
	t = t.UTC()
	y := t.Year()
	lastSunday := func(month time.Month) time.Time {
		d := time.Date(y, month+1, 0, 0, 0, 0, 0, time.UTC) // last day of the month
		return d.AddDate(0, 0, -int(d.Weekday()))
	}
	yy := func(n int) string { return fmt.Sprintf("%02d", ((n%100)+100)%100) }
	if !t.Before(lastSunday(time.March)) && t.Before(lastSunday(time.October)) {
		return "A" + yy(y)
	}
	if !t.Before(lastSunday(time.October)) {
		return "B" + yy(y)
	}
	return "B" + yy(y-1)
}

// eibiPrevious is the season before: B26 -> A26, A27 -> B26.
func eibiPrevious(s string) string {
	if len(s) != 3 {
		return s
	}
	if s[0] == 'B' {
		return "A" + s[1:]
	}
	n := int(s[1]-'0')*10 + int(s[2]-'0')
	return fmt.Sprintf("B%02d", (n+99)%100)
}

// latin1 turns Latin-1 bytes into a UTF-8 string. (A file that is already UTF-8 is left alone.)
func latin1(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var sb strings.Builder
	sb.Grow(len(b) + len(b)/16)
	for _, c := range b {
		sb.WriteRune(rune(c))
	}
	return sb.String()
}

func (s *Server) getEibi() (map[string]any, error) {
	return s.cache.Get("eibi", eibiTTL, func() (map[string]any, error) {
		base := strings.TrimSuffix(s.cfg.EibiURL, "/") + "/"
		text := func(name string) (string, error) {
			b, err := s.fetch(base+name, 30*time.Second)
			if err != nil {
				return "", err
			}
			return latin1(b), nil
		}
		season := eibiSeason(s.clock.Now())
		csv, err := text("sked-" + strings.ToLower(season) + ".csv")
		if err != nil {
			// Early in a season the new file may not be out yet.
			season = eibiPrevious(season)
			if csv, err = text("sked-" + strings.ToLower(season) + ".csv"); err != nil {
				return nil, err
			}
		}
		if !strings.HasPrefix(csv, "kHz:") || len(csv) > 8e6 {
			return nil, errors.New("EiBi's file isn't the schedule")
		}
		readme, err := text("README.TXT")
		if err != nil || len(readme) > 2e6 {
			readme = ""
		}
		return map[string]any{"season": season, "at": s.clock.Millis(), "csv": csv, "readme": readme, "source": "EiBi, eibispace.de"}, nil
	})
}

// sendBigJSON sends a large answer (the EiBi schedule, ~600 kB), gzipped when the browser accepts it,
// and lets the browser keep it for maxAge seconds.
func sendBigJSON(w http.ResponseWriter, r *http.Request, body any, maxAge int) {
	h := w.Header()
	for k, v := range securityHeaders {
		h.Set(k, v)
	}
	h.Set("Content-Type", "application/json")
	h.Set("Cache-Control", fmt.Sprintf("private, max-age=%d", maxAge))
	h.Set("Vary", "Accept-Encoding")
	b, _ := json.Marshal(body)
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		var z bytes.Buffer
		zw := gzip.NewWriter(&z)
		zw.Write(b)
		zw.Close()
		b = z.Bytes()
		h.Set("Content-Encoding", "gzip")
	}
	w.WriteHeader(200)
	if r.Method != http.MethodHead {
		w.Write(b)
	}
}
