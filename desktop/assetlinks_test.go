package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

const fpA = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89"
const fpB = "11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF"

func getAssetLinks(t *testing.T, cfg Config, method string) (int, string, string) {
	t.Helper()
	req := httptest.NewRequest(method, "/.well-known/assetlinks.json", nil)
	rec := httptest.NewRecorder()
	NewServer(cfg).ServeHTTP(rec, req)
	return rec.Code, rec.Header().Get("Content-Type"), rec.Body.String()
}

func TestAssetLinksNotThereUntilConfigured(t *testing.T) {
	for _, certs := range []string{"", " , ", "not-a-fingerprint", "AB:CD"} {
		if code, _, _ := getAssetLinks(t, Config{AndroidCerts: certs}, "GET"); code != 404 {
			t.Errorf("certs %q: got %d, want 404", certs, code)
		}
	}
	if code, _, _ := getAssetLinks(t, Config{AndroidCerts: fpA, AndroidPackage: "not a package"}, "GET"); code != 404 {
		t.Errorf("bad package: got %d, want 404", code)
	}
}

func TestAssetLinksListsTheApp(t *testing.T) {
	code, typ, body := getAssetLinks(t, Config{AndroidCerts: " " + strings.ToLower(fpA) + ", " + fpB + ",junk," + fpA}, "GET")
	if code != 200 || typ != "application/json" {
		t.Fatalf("got %d %s: %s", code, typ, body)
	}
	var got []struct {
		Relation []string `json:"relation"`
		Target   struct {
			Namespace   string   `json:"namespace"`
			PackageName string   `json:"package_name"`
			Prints      []string `json:"sha256_cert_fingerprints"`
		} `json:"target"`
	}
	if err := json.Unmarshal([]byte(body), &got); err != nil || len(got) != 1 {
		t.Fatalf("body %s: %v", body, err)
	}
	g := got[0]
	if len(g.Relation) != 1 || g.Relation[0] != "delegate_permission/common.handle_all_urls" || g.Target.Namespace != "android_app" {
		t.Errorf("statement: %+v", g)
	}
	if g.Target.PackageName != androidPackageDefault {
		t.Errorf("package: %s", g.Target.PackageName)
	}
	if strings.Join(g.Target.Prints, " ") != fpA+" "+fpB {
		t.Errorf("fingerprints: %v", g.Target.Prints)
	}
}

func TestAssetLinksOwnPackageAndHead(t *testing.T) {
	_, _, body := getAssetLinks(t, Config{AndroidCerts: fpA, AndroidPackage: " uk.example.radio "}, "GET")
	if !strings.Contains(body, `"package_name":"uk.example.radio"`) {
		t.Errorf("package not used: %s", body)
	}
	if code, _, _ := getAssetLinks(t, Config{AndroidCerts: fpA}, "HEAD"); code != 200 {
		t.Errorf("HEAD: %d", code)
	}
	if code, _, _ := getAssetLinks(t, Config{AndroidCerts: fpA}, "POST"); code != 405 {
		t.Errorf("POST: %d", code)
	}
}

func TestPrivacyPageIsServed(t *testing.T) {
	req := httptest.NewRequest("GET", "/privacy", nil)
	rec := httptest.NewRecorder()
	NewServer(Config{}).ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Privacy") || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("privacy: %d %s", rec.Code, rec.Header().Get("Cache-Control"))
	}
}
