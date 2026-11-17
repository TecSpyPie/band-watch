package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestNewerVersion(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"1.12.2", "1.12.1", true}, {"v1.13.0", "1.12.9", true}, {"2.0.0", "1.99.99", true},
		{"1.12.1", "1.12.1", false}, {"1.12.0", "1.12.1", false}, {"1.10.0", "1.9.9", true}, {"x", "1.0.0", false},
	}
	for _, c := range cases {
		if got := newerVersion(c.a, c.b); got != c.want {
			t.Errorf("newerVersion(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

// A pretend GitHub: the latest-release API, the installer and its checksums.
func fakeGitHub(t *testing.T, tag string, setup []byte, sumOverride string) *httptest.Server {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/latest":
			json.NewEncoder(w).Encode(map[string]any{
				"tag_name": tag, "html_url": srv.URL + "/page",
				"assets": []map[string]any{
					{"name": "BandWatch-Setup.exe", "browser_download_url": srv.URL + "/dl/BandWatch-Setup.exe"},
					{"name": "SHA256SUMS.txt", "browser_download_url": srv.URL + "/dl/SHA256SUMS.txt"},
				},
			})
		case "/dl/BandWatch-Setup.exe":
			w.Write(setup)
		case "/dl/SHA256SUMS.txt":
			sum := sha256.Sum256(setup)
			h := hex.EncodeToString(sum[:])
			if sumOverride != "" {
				h = sumOverride
			}
			fmt.Fprintf(w, "%s  BandWatch-Setup-%s.exe\n%s  BandWatch-Setup.exe\n", strings.Repeat("0", 64), tag, h)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func updateServer(t *testing.T, gh *httptest.Server) (*Server, *[]string) {
	cfg := defaultConfig()
	cfg.TestHooks = true
	cfg.UpdateURL = gh.URL + "/api/latest"
	cfg.UpdateAssets = gh.URL + "/dl/"
	s := NewServer(cfg)
	s.updatesAllowed = true
	ran := []string{}
	s.runInstaller = func(p string) error { ran = append(ran, p); return nil }
	return s, &ran
}

func call(s *Server, method, path string, hdr map[string]string) (int, map[string]any) {
	req := httptest.NewRequest(method, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	out := map[string]any{}
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestUpdateCheckAndInstall(t *testing.T) {
	old := version
	version = "1.12.1"
	t.Cleanup(func() { version = old })
	setup := []byte("MZ pretend installer " + strings.Repeat("x", 5000))
	gh := fakeGitHub(t, "v1.12.2", setup, "")
	s, ran := updateServer(t, gh)

	code, body := call(s, "GET", "/api/update", nil)
	if code != 200 || body["latest"] != "1.12.2" || body["newer"] != true || body["canInstall"] != true || body["current"] != "1.12.1" {
		t.Fatalf("check: %d %v", code, body)
	}
	// Needs the header (so other web sites can't trigger it)
	if code, _ := call(s, "POST", "/api/update/install", nil); code != 403 {
		t.Errorf("without header: %d", code)
	}
	code, body = call(s, "POST", "/api/update/install", map[string]string{"X-Band-Watch": "update"})
	if code != 200 || body["installing"] != "1.12.2" {
		t.Fatalf("install: %d %v", code, body)
	}
	if len(*ran) != 1 || !strings.HasSuffix((*ran)[0], "BandWatch-Setup-1.12.2.exe") {
		t.Fatalf("ran %v", *ran)
	}
	got, err := os.ReadFile((*ran)[0])
	if err != nil || string(got) != string(setup) {
		t.Error("the saved installer isn't the downloaded one")
	}
}

func TestUpdateRefusesBadChecksumsAndOldVersions(t *testing.T) {
	old := version
	version = "1.12.1"
	t.Cleanup(func() { version = old })
	setup := []byte("MZ tampered")
	s, ran := updateServer(t, fakeGitHub(t, "v1.12.2", setup, strings.Repeat("a", 64)))
	code, body := call(s, "POST", "/api/update/install", map[string]string{"X-Band-Watch": "update"})
	if code != 502 || !strings.Contains(fmt.Sprint(body["error"]), "checksum doesn't match") || len(*ran) != 0 {
		t.Fatalf("bad checksum: %d %v %v", code, body, *ran)
	}
	s2, ran2 := updateServer(t, fakeGitHub(t, "v1.12.1", setup, ""))
	if code, _ := call(s2, "POST", "/api/update/install", map[string]string{"X-Band-Watch": "update"}); code != 409 || len(*ran2) != 0 {
		t.Fatalf("same version: %d", code)
	}
	// Files from anywhere else are refused
	s3, ran3 := updateServer(t, fakeGitHub(t, "v9.0.0", setup, ""))
	s3.cfg.UpdateAssets = "https://example.invalid/"
	if code, _ := call(s3, "POST", "/api/update/install", map[string]string{"X-Band-Watch": "update"}); code != 502 || len(*ran3) != 0 {
		t.Fatalf("other host: %d", code)
	}
	// And not at all outside the desktop app
	s4, _ := updateServer(t, fakeGitHub(t, "v9.0.0", setup, ""))
	s4.updatesAllowed = false
	if code, _ := call(s4, "POST", "/api/update/install", map[string]string{"X-Band-Watch": "update"}); code != 404 {
		t.Fatalf("not desktop: %d", code)
	}
	if _, body := call(s4, "GET", "/api/update", nil); body["canInstall"] != false || body["newer"] != true {
		t.Fatalf("check outside desktop: %v", body)
	}
}
