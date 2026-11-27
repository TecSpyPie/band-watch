package main

// Updates: is there a newer ClearRX in HamShack's latest GitHub release? The release carries
// clearrx-version.txt (just the version) and ClearRX-Windows.zip. To update, ClearRX downloads the
// zip, checks its SHA-256 against the release's SHA256SUMS.txt, puts the new files next to itself
// (the running ClearRX.exe is renamed to ClearRX.exe.old first, which Windows allows), starts the new
// one and closes. The new ClearRX asks the old one to quit (it already does that for an older
// version), and the page reloads itself when it sees the new version. Receive only: nothing transmits.

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	releaseLatest = "https://github.com/TecSpyPie/band-watch/releases/latest/download/"
	zipName       = "ClearRX-Windows.zip"
	maxZipBytes   = 60 << 20
	updateTTL     = time.Hour
)

var semverRe = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)$`)

// newerVersion: is a (like "1.6.1") newer than b? "dev" or anything odd is never newer.
func newerVersion(a, b string) bool {
	ma, mb := semverRe.FindStringSubmatch(strings.TrimSpace(a)), semverRe.FindStringSubmatch(strings.TrimSpace(b))
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

// Updater holds what the update needs; tests point base at a test server and dir at a temp folder.
type Updater struct {
	base    string // where the release files are, ending in "/"
	dir     string // ClearRX's own folder ("" means updates can't be installed here)
	current string
	client  *http.Client
	restart func(exe string) error // starts the new ClearRX
	quit    func()

	mu      sync.Mutex
	checked time.Time
	latest  string
	busy    bool
}

func (u *Updater) get(name string, limit int64) ([]byte, error) {
	res, err := u.client.Get(u.base + name)
	if err != nil {
		return nil, errors.New("couldn't reach GitHub")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub hasn't got %s (it answered %d)", name, res.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, errors.New("the download stopped part way")
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("%s is bigger than expected", name)
	}
	return b, nil
}

// Latest: the newest ClearRX version in the latest release (cached for an hour).
func (u *Updater) Latest(force bool) (string, error) {
	u.mu.Lock()
	if !force && u.latest != "" && time.Since(u.checked) < updateTTL {
		v := u.latest
		u.mu.Unlock()
		return v, nil
	}
	u.mu.Unlock()
	b, err := u.get("clearrx-version.txt", 64)
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(string(b))
	if !semverRe.MatchString(v) {
		return "", errors.New("the release's version file doesn't look right")
	}
	u.mu.Lock()
	u.latest, u.checked = v, time.Now()
	u.mu.Unlock()
	return v, nil
}

// sumFor finds a file's SHA-256 in a SHA256SUMS.txt ("<hex>  <name>" lines).
func sumFor(sums []byte, name string) (string, bool) {
	sc := bufio.NewScanner(bytes.NewReader(sums))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == name && len(f[0]) == 64 {
			return strings.ToLower(f[0]), true
		}
	}
	return "", false
}

// unzipFiles: the files in the zip's ClearRX folder, by plain file name. Anything else (other folders,
// "..", subfolders) is refused, so a bad zip can't write outside ClearRX's folder.
func unzipFiles(b []byte) (map[string][]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, errors.New("the download isn't a proper zip")
	}
	files := map[string][]byte{}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := strings.TrimPrefix(path.Clean(f.Name), "ClearRX/")
		if name == "" || strings.ContainsAny(name, `/\:`) || name == "." || name == ".." || strings.HasPrefix(name, ".") {
			return nil, fmt.Errorf("the zip has an unexpected file (%s)", f.Name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(io.LimitReader(rc, maxZipBytes))
		rc.Close()
		if err != nil {
			return nil, err
		}
		files[name] = data
	}
	if _, ok := files["ClearRX.exe"]; !ok {
		return nil, errors.New("the zip has no ClearRX.exe")
	}
	return files, nil
}

// Install downloads, checks and puts the new ClearRX in place, then restarts it.
func (u *Updater) Install() (string, error) {
	if u.dir == "" {
		return "", errors.New("updates can only be installed in the ClearRX program on Windows")
	}
	u.mu.Lock()
	if u.busy {
		u.mu.Unlock()
		return "", errors.New("an update is already going")
	}
	u.busy = true
	u.mu.Unlock()
	defer func() { u.mu.Lock(); u.busy = false; u.mu.Unlock() }()

	latest, err := u.Latest(true)
	if err != nil {
		return "", err
	}
	if !newerVersion(latest, u.current) {
		return "", errors.New("you already have the newest ClearRX")
	}
	sums, err := u.get("SHA256SUMS.txt", 64<<10)
	if err != nil {
		return "", err
	}
	want, ok := sumFor(sums, zipName)
	if !ok {
		return "", errors.New("the release doesn't list ClearRX's check number, so it wasn't installed")
	}
	zb, err := u.get(zipName, maxZipBytes)
	if err != nil {
		return "", err
	}
	got := sha256.Sum256(zb)
	if hex.EncodeToString(got[:]) != want {
		return "", errors.New("the download didn't match its check number, so it wasn't installed")
	}
	files, err := unzipFiles(zb)
	if err != nil {
		return "", err
	}
	// The other files first, then swap ClearRX.exe: rename the running one out of the way.
	for name, data := range files {
		if name == "ClearRX.exe" {
			continue
		}
		if err := os.WriteFile(filepath.Join(u.dir, name), data, 0o644); err != nil {
			return "", fmt.Errorf("couldn't write %s: %v", name, err)
		}
	}
	exe := filepath.Join(u.dir, "ClearRX.exe")
	tmp := exe + ".new"
	if err := os.WriteFile(tmp, files["ClearRX.exe"], 0o755); err != nil {
		return "", fmt.Errorf("couldn't write the new ClearRX: %v", err)
	}
	_ = os.Remove(exe + ".old")
	if err := os.Rename(exe, exe+".old"); err != nil && !os.IsNotExist(err) {
		os.Remove(tmp)
		return "", fmt.Errorf("couldn't move the old ClearRX aside: %v", err)
	}
	if err := os.Rename(tmp, exe); err != nil {
		os.Rename(exe+".old", exe) // put the old one back
		return "", fmt.Errorf("couldn't put the new ClearRX in place: %v", err)
	}
	if u.restart != nil {
		if err := u.restart(exe); err != nil {
			return latest, fmt.Errorf("ClearRX %s is installed: close ClearRX and open it again", latest)
		}
	}
	if u.quit != nil {
		go func() { time.Sleep(1500 * time.Millisecond); u.quit() }()
	}
	return latest, nil
}

// cleanOld removes the ClearRX.exe.old left by the last update (it can't be removed while it runs).
func cleanOld(dir string) {
	if dir != "" {
		_ = os.Remove(filepath.Join(dir, "ClearRX.exe.old"))
	}
}

func (a *App) updateAPI(w http.ResponseWriter, r *http.Request) {
	u := a.updater
	if u == nil {
		sendJSON(w, 200, map[string]any{"current": version, "canInstall": false})
		return
	}
	switch r.Method {
	case http.MethodGet:
		latest, err := u.Latest(r.URL.Query().Get("force") == "1")
		out := map[string]any{"current": u.current, "latest": latest, "newer": err == nil && newerVersion(latest, u.current), "canInstall": u.dir != ""}
		if err != nil {
			out["error"] = err.Error()
		}
		sendJSON(w, 200, out)
	case http.MethodPost:
		// Only ClearRX's own page (which sends this header; another site's page can't)
		if r.Header.Get("X-ClearRX") != "update" {
			sendJSON(w, 403, map[string]string{"error": "not allowed"})
			return
		}
		v, err := u.Install()
		if err != nil {
			sendJSON(w, 200, map[string]any{"ok": false, "error": err.Error(), "version": v})
			return
		}
		sendJSON(w, 200, map[string]any{"ok": true, "version": v})
	default:
		sendJSON(w, 405, map[string]string{"error": "method not allowed"})
	}
}
