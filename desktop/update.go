package main

// Updates: is there a newer Band Watch on GitHub? In the desktop app on Windows, download the new
// installer from the release, check it against the release's SHA256SUMS.txt, and run it silently
// (/S). The installer stops this Band Watch, puts the new version over it in the same folder, and
// starts it again.

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	updateTTL      = time.Hour
	updateFreshTTL = 2 * time.Minute // "Check now" asks GitHub again, but at most once every 2 minutes
	releasesAPI    = "https://api.github.com/repos/TecSpyPie/band-watch/releases/latest"
	releaseAssets  = "https://github.com/TecSpyPie/band-watch/releases/download/"
	maxSetupBytes  = 80 << 20
	setupAssetName = "BandWatch-Setup.exe"
)

var semverRe = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)$`)

// newerVersion: is a (like "1.12.2" or "v1.12.2") newer than b?
func newerVersion(a, b string) bool {
	ma, mb := semverRe.FindStringSubmatch(a), semverRe.FindStringSubmatch(b)
	if ma == nil || mb == nil {
		return false
	}
	for i := 1; i <= 3; i++ {
		x, _ := strconv.Atoi(ma[i])
		y, _ := strconv.Atoi(mb[i])
		if x != y {
			return x > y
		}
	}
	return false
}

// latestRelease: the newest release's version and the addresses of its installer and checksums.
// fresh ("Check now") asks GitHub again if the last answer is over 2 minutes old; otherwise it's kept an hour.
func (s *Server) latestRelease(fresh bool) (map[string]any, error) {
	ttl := updateTTL
	if fresh {
		ttl = updateFreshTTL
	}
	return s.cache.Get("update", ttl, func() (map[string]any, error) {
		var rel struct {
			Tag    string `json:"tag_name"`
			Page   string `json:"html_url"`
			Assets []struct {
				Name string `json:"name"`
				URL  string `json:"browser_download_url"`
			} `json:"assets"`
		}
		if err := s.fetchJSON(s.cfg.UpdateURL, 20*time.Second, &rel); err != nil {
			return nil, err
		}
		v := strings.TrimPrefix(rel.Tag, "v")
		if !semverRe.MatchString(v) {
			return nil, errors.New("the latest release has no version number")
		}
		out := map[string]any{"latest": v, "page": rel.Page, "setup": "", "sums": "",
			"checked": s.clock.Now().UTC().Format("2006-01-02T15:04:05.000Z")}
		for _, a := range rel.Assets {
			switch a.Name {
			case setupAssetName:
				out["setup"] = a.URL
			case "SHA256SUMS.txt":
				out["sums"] = a.URL
			}
		}
		return out, nil
	})
}

func (s *Server) canInstallUpdates() bool { return s.updatesAllowed }

func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	rel, err := s.latestRelease(r.URL.Query().Get("fresh") == "1")
	if err != nil {
		sendJSON(w, 502, errJSON("Couldn't check for updates just now."), nil)
		return
	}
	latest, _ := rel["latest"].(string)
	setup, _ := rel["setup"].(string)
	sendJSON(w, 200, map[string]any{
		"current": version, "latest": latest, "newer": newerVersion(latest, version), "page": rel["page"],
		"canInstall": s.canInstallUpdates() && setup != "",
		"checked": rel["checked"], "stale": rel["stale"] == true,
	}, nil)
}

// assetAllowed: only files from Band Watch's own GitHub releases (or the test server's).
func (s *Server) assetAllowed(u string) bool {
	prefix := releaseAssets
	if s.cfg.TestHooks && s.cfg.UpdateAssets != "" {
		prefix = s.cfg.UpdateAssets
	}
	return u != "" && strings.HasPrefix(u, prefix)
}

func (s *Server) handleUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if !s.canInstallUpdates() {
		sendJSON(w, 404, errJSON("not found"), nil)
		return
	}
	// Only Band Watch's own page can ask for this: a custom header needs the browser's permission
	// from any other web site.
	if r.Header.Get("X-Band-Watch") != "update" {
		sendJSON(w, 403, errJSON("Missing the X-Band-Watch header."), nil)
		return
	}
	rel, err := s.latestRelease(false)
	if err != nil {
		sendJSON(w, 502, errJSON("Couldn't reach GitHub to check for updates."), nil)
		return
	}
	latest, _ := rel["latest"].(string)
	if !newerVersion(latest, version) {
		sendJSON(w, 409, errJSON("You already have the newest version."), nil)
		return
	}
	setupURL, _ := rel["setup"].(string)
	sumsURL, _ := rel["sums"].(string)
	if !s.assetAllowed(setupURL) || !s.assetAllowed(sumsURL) {
		sendJSON(w, 502, errJSON("The release doesn't have the installer and its checksums."), nil)
		return
	}
	path, err := s.downloadSetup(setupURL, sumsURL, latest)
	if err != nil {
		sendJSON(w, 502, errJSON("The update couldn't be downloaded safely: "+err.Error()), nil)
		return
	}
	if err := s.runInstaller(path); err != nil {
		sendJSON(w, 500, errJSON("The installer couldn't be started: "+err.Error()), nil)
		return
	}
	sendJSON(w, 200, map[string]any{"ok": true, "installing": latest}, nil)
}

// downloadSetup fetches the installer, checks its SHA-256 against SHA256SUMS.txt, and saves it in the temp folder.
func (s *Server) downloadSetup(setupURL, sumsURL, ver string) (string, error) {
	sums, err := s.fetch(sumsURL, 30*time.Second)
	if err != nil {
		return "", err
	}
	want := ""
	sc := bufio.NewScanner(strings.NewReader(string(sums)))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == setupAssetName {
			want = strings.ToLower(f[0])
		}
	}
	if len(want) != 64 {
		return "", errors.New("no checksum for the installer")
	}
	req, err := http.NewRequest("GET", setupURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent())
	client := *s.client
	client.Timeout = 5 * time.Minute
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", fmt.Errorf("GitHub answered %d", res.StatusCode)
	}
	dir, err := os.MkdirTemp("", "bandwatch-update-")
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, "BandWatch-Setup-"+ver+".exe")
	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(res.Body, maxSetupBytes+1))
	f.Close()
	if err == nil && n > maxSetupBytes {
		err = errors.New("the installer is far too big")
	}
	if err == nil && hex.EncodeToString(h.Sum(nil)) != want {
		err = errors.New("its checksum doesn't match the release's (it may have been changed or damaged)")
	}
	if err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	return path, nil
}

// startInstaller runs the new installer silently, on its own, so it carries on after this Band Watch stops.
func startInstaller(path string) error {
	cmd := exec.Command(path, "/S")
	cmd.Dir = filepath.Dir(path)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
