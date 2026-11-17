package main

import (
	"path/filepath"
	"testing"
)

func TestAppBrowser(t *testing.T) {
	env := map[string]string{"ProgramFiles": "/pf", "ProgramFiles(x86)": "/pf86", "LOCALAPPDATA": "/local"}
	getenv := func(k string) string { return env[k] }
	have := func(paths ...string) func(string) bool {
		return func(p string) bool {
			for _, x := range paths {
				if p == x {
					return true
				}
			}
			return false
		}
	}
	edge := filepath.Join("/pf86", "Microsoft", "Edge", "Application", "msedge.exe")
	chrome := filepath.Join("/pf", "Google", "Chrome", "Application", "chrome.exe")
	userChrome := filepath.Join("/local", "Google", "Chrome", "Application", "chrome.exe")
	cases := []struct {
		name  string
		files []string
		want  string
	}{
		{"edge first", []string{chrome, edge}, edge},
		{"chrome only", []string{chrome}, chrome},
		{"chrome for one user", []string{userChrome}, userChrome},
		{"neither", nil, ""},
	}
	for _, c := range cases {
		if got := appBrowser(getenv, have(c.files...)); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
	if got := appBrowser(func(string) string { return "" }, have(edge)); got != "" {
		t.Errorf("no environment: got %q", got)
	}
}

func TestAppWindowArgs(t *testing.T) {
	a := appWindowArgs("http://localhost:8073/")
	if len(a) == 0 || a[0] != "--app=http://localhost:8073/" {
		t.Fatalf("args %v", a)
	}
}
