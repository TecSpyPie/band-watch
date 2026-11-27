package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func makeZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	zw.Close()
	return buf.Bytes()
}

// A pretend GitHub release: the version file, the zip and SHA256SUMS.txt.
func fakeRelease(t *testing.T, ver string, zb []byte, sum string) *httptest.Server {
	t.Helper()
	if sum == "" {
		h := sha256.Sum256(zb)
		sum = hex.EncodeToString(h[:])
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/clearrx-version.txt":
			w.Write([]byte(ver + "\n"))
		case "/ClearRX-Windows.zip":
			w.Write(zb)
		case "/SHA256SUMS.txt":
			w.Write([]byte("aaaa  BandWatch-Setup.exe\n" + sum + "  ClearRX-Windows.zip\n"))
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestNewerVersion(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{{"1.6.1", "1.6.0", true}, {"1.10.0", "1.9.9", true}, {"v2.0.0", "1.9.9", true}, {"1.6.0", "1.6.0", false},
		{"1.5.9", "1.6.0", false}, {"dev", "1.0.0", false}, {"1.6.1", "dev", false}, {"1.6", "1.5.0", false}}
	for _, c := range cases {
		if got := newerVersion(c.a, c.b); got != c.want {
			t.Errorf("newerVersion(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

func TestUnzipRefusesFilesOutsideTheFolder(t *testing.T) {
	good := makeZip(t, map[string]string{"ClearRX/ClearRX.exe": "new", "ClearRX/LICENSE": "l"})
	if f, err := unzipFiles(good); err != nil || f["ClearRX.exe"] == nil || f["LICENSE"] == nil {
		t.Fatalf("good zip: %v %v", f, err)
	}
	for _, bad := range []string{"../evil.exe", "ClearRX/../../evil.exe", "ClearRX/sub/evil.exe", "C:/evil.exe", "ClearRX/.hidden"} {
		zb := makeZip(t, map[string]string{"ClearRX/ClearRX.exe": "new", bad: "x"})
		if _, err := unzipFiles(zb); err == nil {
			t.Errorf("%s was allowed", bad)
		}
	}
	if _, err := unzipFiles(makeZip(t, map[string]string{"ClearRX/LICENSE": "l"})); err == nil {
		t.Error("a zip with no ClearRX.exe was allowed")
	}
	if _, err := unzipFiles([]byte("not a zip")); err == nil {
		t.Error("not a zip was allowed")
	}
}

func TestInstallSwapsTheProgramAndRestarts(t *testing.T) {
	zb := makeZip(t, map[string]string{"ClearRX/ClearRX.exe": "new program", "ClearRX/README-ClearRX.txt": "new readme"})
	srv := fakeRelease(t, "1.7.0", zb, "")
	defer srv.Close()
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "ClearRX.exe"), []byte("old program"), 0o755)
	os.WriteFile(filepath.Join(dir, "clearrx-settings.json"), []byte(`{"keep":"me"}`), 0o644)
	var restarted string
	u := &Updater{base: srv.URL + "/", dir: dir, current: "1.6.0", client: srv.Client(), restart: func(exe string) error { restarted = exe; return nil }}
	v, err := u.Install()
	if err != nil || v != "1.7.0" {
		t.Fatalf("Install: %q %v", v, err)
	}
	read := func(n string) string { b, _ := os.ReadFile(filepath.Join(dir, n)); return string(b) }
	if read("ClearRX.exe") != "new program" || read("README-ClearRX.txt") != "new readme" {
		t.Error("new files not in place")
	}
	if read("ClearRX.exe.old") != "old program" {
		t.Error("the old program wasn't kept aside")
	}
	if read("clearrx-settings.json") != `{"keep":"me"}` {
		t.Error("the settings were touched")
	}
	if restarted != filepath.Join(dir, "ClearRX.exe") {
		t.Errorf("restarted %q", restarted)
	}
	cleanOld(dir)
	if _, err := os.Stat(filepath.Join(dir, "ClearRX.exe.old")); !os.IsNotExist(err) {
		t.Error("the old program wasn't cleaned up on the next start")
	}
}

func TestInstallRefusesABadDownload(t *testing.T) {
	zb := makeZip(t, map[string]string{"ClearRX/ClearRX.exe": "new program"})
	for name, srv := range map[string]*httptest.Server{
		"wrong check number": fakeRelease(t, "1.7.0", zb, strings.Repeat("0", 64)),
		"not newer":          fakeRelease(t, "1.6.0", zb, ""),
	} {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "ClearRX.exe"), []byte("old program"), 0o755)
		u := &Updater{base: srv.URL + "/", dir: dir, current: "1.6.0", client: srv.Client(), restart: func(string) error { t.Error(name + ": restarted"); return nil }}
		if _, err := u.Install(); err == nil {
			t.Errorf("%s: installed", name)
		}
		if b, _ := os.ReadFile(filepath.Join(dir, "ClearRX.exe")); string(b) != "old program" {
			t.Errorf("%s: the program was changed", name)
		}
		srv.Close()
	}
	// Not in the Windows program: nothing is installed
	u := &Updater{base: "http://127.0.0.1:1/", current: "1.6.0", client: http.DefaultClient}
	if _, err := u.Install(); err == nil {
		t.Error("installed with no folder")
	}
}

func TestUpdateAPI(t *testing.T) {
	zb := makeZip(t, map[string]string{"ClearRX/ClearRX.exe": "new"})
	srv := fakeRelease(t, "1.7.0", zb, "")
	defer srv.Close()
	a := NewApp("", nil)
	a.updater = &Updater{base: srv.URL + "/", current: "1.6.0", client: srv.Client()}
	rec := httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest("GET", "/api/update", nil))
	var got map[string]any
	json.Unmarshal(rec.Body.Bytes(), &got)
	if got["latest"] != "1.7.0" || got["newer"] != true || got["canInstall"] != false {
		t.Errorf("GET: %v", got)
	}
	// Installing needs ClearRX's own page's header
	rec = httptest.NewRecorder()
	a.ServeHTTP(rec, httptest.NewRequest("POST", "/api/update", nil))
	if rec.Code != 403 {
		t.Errorf("POST without the header: %d", rec.Code)
	}
	// No updater (tests, the browser-only copy): just the version
	b := NewApp("", nil)
	rec = httptest.NewRecorder()
	b.ServeHTTP(rec, httptest.NewRequest("GET", "/api/update", nil))
	if !strings.Contains(rec.Body.String(), `"canInstall":false`) {
		t.Errorf("no updater: %s", rec.Body.String())
	}
}
