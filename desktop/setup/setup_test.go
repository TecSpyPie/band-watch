package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Installs into an empty folder and over an old (Node.js era) install, silently.
func TestInstall(t *testing.T) {
	files, err := readPayload()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"BandWatch.exe", "start-bandwatch.bat", "stop-bandwatch.bat", "uninstall.bat", "make-shortcuts.ps1",
		"bandwatch.ico", "README-Windows.txt", "server/server.js", "server/public/index.html", "server/public/js/ft8.js"} {
		if _, ok := files[want]; !ok {
			t.Errorf("payload is missing %s", want)
		}
	}
	dest := filepath.Join(t.TempDir(), "BandWatch")
	// an old install: Node.js files at the top level, and an outdated exe
	os.MkdirAll(filepath.Join(dest, "public"), 0o755)
	os.WriteFile(filepath.Join(dest, "server.js"), []byte("old"), 0o644)
	os.WriteFile(filepath.Join(dest, "public", "index.html"), []byte("old"), 0o644)
	os.WriteFile(filepath.Join(dest, "BandWatch.exe"), []byte("old"), 0o644)
	if err := install(dest, true, true); err != nil {
		t.Fatal(err)
	}
	for name, data := range files {
		got, err := os.ReadFile(filepath.Join(dest, filepath.FromSlash(name)))
		if err != nil || len(got) != len(data) {
			t.Errorf("%s not installed correctly", name)
		}
	}
	if _, err := os.Stat(filepath.Join(dest, "server.js")); !os.IsNotExist(err) {
		t.Error("old server.js left behind")
	}
	if _, err := os.Stat(filepath.Join(dest, "public")); !os.IsNotExist(err) {
		t.Error("old public folder left behind")
	}
	if dirSizeKB(dest) < 1000 {
		t.Error("install folder is too small")
	}
}

func TestCanWrite(t *testing.T) {
	if err := canWrite(filepath.Join(t.TempDir(), "a", "BandWatch")); err != nil {
		t.Fatal(err)
	}
	ro := t.TempDir()
	os.Chmod(ro, 0o500)
	defer os.Chmod(ro, 0o700)
	if os.Geteuid() != 0 { // root can write anywhere
		if err := canWrite(filepath.Join(ro, "BandWatch")); err == nil {
			t.Fatal("expected an error for a read-only folder")
		}
	}
}

func TestRemovesOldCopy(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	old := filepath.Join(localAppData(), "BandWatch")
	os.MkdirAll(old, 0o755)
	os.WriteFile(filepath.Join(old, "BandWatch.exe"), []byte("old"), 0o644)
	dest := filepath.Join(t.TempDir(), "BandWatch")
	if err := install(dest, true, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Error("old copy not removed")
	}
	if _, err := os.Stat(filepath.Join(dest, "BandWatch.exe")); err != nil {
		t.Error("new copy missing")
	}
}

func TestRemovesFolderLeftWithOnlyTheLog(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	old := filepath.Join(localAppData(), "BandWatch")
	os.MkdirAll(old, 0o755)
	os.WriteFile(filepath.Join(old, "bandwatch.log"), []byte("log"), 0o644)
	os.WriteFile(filepath.Join(old, "bandwatch.log.old"), []byte("log"), 0o644)
	removeOldCopy(filepath.Join(t.TempDir(), "BandWatch"), false)
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Error("folder holding only the old log not removed")
	}
	// Anything else in it is left alone
	os.MkdirAll(old, 0o755)
	os.WriteFile(filepath.Join(old, "notes.txt"), []byte("mine"), 0o644)
	removeOldCopy(filepath.Join(t.TempDir(), "BandWatch"), false)
	if _, err := os.Stat(filepath.Join(old, "notes.txt")); err != nil {
		t.Error("removed a folder with other files in it")
	}
}

func TestSuggestedDest(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	old := filepath.Join(localAppData(), "BandWatch")
	def := filepath.Join(t.TempDir(), "BandWatch")
	if got := suggestedDest("", def); got != def {
		t.Errorf("new install: %s", got)
	}
	if got := suggestedDest(old, def); got != def {
		t.Errorf("old AppData copy should move to %s, got %s", def, got)
	}
	elsewhere := filepath.Join(t.TempDir(), "Radio", "BandWatch")
	if got := suggestedDest(elsewhere, def); got != elsewhere {
		t.Errorf("a folder the user chose stays: %s", got)
	}
}

func TestInstalledVersion(t *testing.T) {
	dir := t.TempDir()
	if got := installedVersion(dir); got != "the version you have" {
		t.Error(got)
	}
	os.WriteFile(filepath.Join(dir, "BUILD-INFO.txt"), []byte("Band Watch by M3vrv\r\nVersion 1.12.1\r\nBuilt 2026-11-17T03:38:45Z\r\n"), 0o644)
	if got := installedVersion(dir); got != "1.12.1" {
		t.Error(got)
	}
}
