package main

// Upcoming contests from the WA7BNM Contest Calendar RSS feed: the Windows app's copy of contests.js.
//   GET /api/contests -> { source, link, contests[{ name, link, when, start, end }], at, stale? }
// The feed's terms allow showing it on a non-profit site when it is labelled "WA7BNM Contest Calendar" and
// links back to the site; the page does both. Fetched at most once every 6 hours.

import (
	"html"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const contestsTTL = 6 * time.Hour

var (
	contestMonths = map[string]time.Month{"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6, "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
	contestItemRe = regexp.MustCompile(`(?s)<item>(.*?)</item>`)
	contestCdata  = regexp.MustCompile(`(?s)<!\[CDATA\[(.*?)\]\]>`)
	contestLinkRe = regexp.MustCompile(`^https://www\.contestcalendar\.com/`)
	// "0000Z-0200Z, Nov 25" and "1200Z, Nov 28 to 1200Z, Nov 29"
	contestOneDay = regexp.MustCompile(`^(\d{4})Z-(\d{4})Z,\s*([A-Z][a-z]{2})\s+(\d{1,2})`)
	contestSpan   = regexp.MustCompile(`^(\d{4})Z,\s*([A-Z][a-z]{2})\s+(\d{1,2})\s+to\s+(\d{4})Z,\s*([A-Z][a-z]{2})\s+(\d{1,2})`)
)

func contestTag(item, name string) string {
	m := regexp.MustCompile(`(?s)<` + name + `>(.*?)</` + name + `>`).FindStringSubmatch(item)
	if m == nil {
		return ""
	}
	s := contestCdata.ReplaceAllString(m[1], "$1")
	return strings.TrimSpace(html.UnescapeString(s))
}

func clipRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

/** The feed has no year: pick the one that puts the month nearest to ref. */
func contestYear(mon time.Month, ref time.Time) int {
	y := ref.UTC().Year()
	best, bestGap := y, time.Duration(1<<62)
	for _, yy := range []int{y - 1, y, y + 1} {
		gap := time.Date(yy, mon, 15, 0, 0, 0, 0, time.UTC).Sub(ref)
		if gap < 0 {
			gap = -gap
		}
		if gap < bestGap {
			best, bestGap = yy, gap
		}
	}
	return best
}

func contestAt(hhmm string, mon time.Month, day int, ref time.Time) time.Time {
	h, _ := strconv.Atoi(hhmm[:2])
	m, _ := strconv.Atoi(hhmm[2:])
	return time.Date(contestYear(mon, ref), mon, day, h, m, 0, 0, time.UTC) // 2400 rolls over to the next day
}

/** The feed's "when" text -> start and end (UTC), or ok=false when it can't be read. */
func parseContestWhen(desc string, ref time.Time) (start, end time.Time, ok bool) {
	if m := contestOneDay.FindStringSubmatch(desc); m != nil {
		mon, known := contestMonths[m[3]]
		if known {
			day, _ := strconv.Atoi(m[4])
			start = contestAt(m[1], mon, day, ref)
			end = contestAt(m[2], mon, day, ref)
			if !end.After(start) {
				end = end.Add(24 * time.Hour)
			}
			return start, end, true
		}
	}
	if m := contestSpan.FindStringSubmatch(desc); m != nil {
		m1, k1 := contestMonths[m[2]]
		m2, k2 := contestMonths[m[5]]
		if k1 && k2 {
			d1, _ := strconv.Atoi(m[3])
			d2, _ := strconv.Atoi(m[6])
			start = contestAt(m[1], m1, d1, ref)
			end = contestAt(m[4], m2, d2, ref)
			if end.Before(start) { // the winter season runs over New Year
				h, _ := strconv.Atoi(m[4][:2])
				mi, _ := strconv.Atoi(m[4][2:])
				end = time.Date(start.Year()+1, m2, d2, h, mi, 0, 0, time.UTC)
			}
			return start, end, true
		}
	}
	return time.Time{}, time.Time{}, false
}

/** The RSS feed -> contests, keeping only items that link to the calendar itself. At most 200. */
func parseContestFeed(xml string, ref time.Time) []map[string]any {
	out := []map[string]any{}
	for _, m := range contestItemRe.FindAllStringSubmatch(xml, -1) {
		name := clipRunes(contestTag(m[1], "title"), 120)
		link := contestTag(m[1], "link")
		when := clipRunes(contestTag(m[1], "description"), 120)
		if name == "" || !contestLinkRe.MatchString(link) {
			continue
		}
		c := map[string]any{"name": name, "link": link, "when": when, "start": nil, "end": nil}
		if s, e, ok := parseContestWhen(when, ref); ok {
			c["start"], c["end"] = s.UnixMilli(), e.UnixMilli()
		}
		out = append(out, c)
		if len(out) == 200 {
			break
		}
	}
	return out
}

func (s *Server) getContests() (map[string]any, error) {
	return s.cache.Get("contests", contestsTTL, func() (map[string]any, error) {
		b, err := s.fetch(s.cfg.ContestURL, 20*time.Second)
		if err != nil {
			return nil, err
		}
		contests := parseContestFeed(string(b), s.clock.Now())
		if len(contests) == 0 {
			return nil, errNoContests
		}
		return map[string]any{"source": "WA7BNM Contest Calendar", "link": "https://www.contestcalendar.com/", "contests": contests, "at": s.clock.Millis()}, nil
	})
}

type contestErr string

func (e contestErr) Error() string { return string(e) }

const errNoContests = contestErr("no contests in the feed")
