// HamShack by M0GLP & M3VRV: Windows installer. BandWatch-Setup.exe carries the whole app inside it
// (payload.zip) and installs it for the current user, without administrator rights:
//   - copies HamShack to C:\BandWatch (or a drive or folder you choose) (stopping an older copy first)
//   - adds desktop and Start menu shortcuts, and optionally starts it with Windows
//   - lists it in Settings > Apps, so it can be uninstalled from there
//   - checks Smart App Control and offers Node.js if Windows would block BandWatch.exe
//
// "BandWatch-Setup.exe /S" installs with the usual answers and no questions.
package main

import (
	"archive/zip"
	"bytes"
	_ "embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

//go:embed payload.zip
var payload []byte

var version = "dev"
var buildDate = "" // set at build time (UTC, RFC 3339)

// builtText is the build date for people: "16 Nov 2026, 20:50 UTC".
func builtText() string {
	t, err := time.Parse(time.RFC3339, buildDate)
	if err != nil {
		return buildDate
	}
	return t.UTC().Format("2 Jan 2006, 15:04 UTC")
}

// versionText is the version with its build date, for the installer's questions.
func versionText() string {
	if buildDate == "" {
		return version
	}
	return version + " (built " + builtText() + ")"
}

const title = "HamShack by M0GLP & M3VRV - Setup"

// Files earlier versions left in the install folder that are no longer used.
var oldFiles = []string{"server.js", "qrz.js", "clock.js", "package.json", "bandwatch-status.ps1"}

func main() {
	silent := flag.Bool("S", false, "install with the usual answers, no questions")
	dest := flag.String("dest", "", "install folder (default C:\\BandWatch)")
	flag.Parse()
	for _, a := range os.Args[1:] {
		if strings.EqualFold(a, "/S") || strings.EqualFold(a, "/silent") {
			*silent = true
		}
	}
	chosen := *dest != ""
	update := false
	if !chosen {
		*dest = suggestedDest(previousLocation(), defaultDest())
		update = fileExists(filepath.Join(*dest, "BandWatch.exe"))
	}
	if update && !*silent {
		// An update: one question, then it goes over the old copy in the same folder.
		old := installedVersion(*dest)
		q := fmt.Sprintf("Update HamShack by M0GLP & M3VRV in %s\n\nfrom %s to %s?\n\nYes: update it (your settings and log are kept)\nNo: install somewhere else\nCancel: don't install", *dest, old, versionText())
		switch askInstallWhere(q) {
		case answerYes:
			chosen = true
		case answerCancel:
			return
		}
	}
	if err := install(*dest, *silent, chosen); err != nil {
		if errors.Is(err, errCancelled) {
			return
		}
		showError(title, "HamShack couldn't be installed:\n\n"+err.Error())
		os.Exit(1)
	}
}

var errCancelled = errors.New("cancelled")

func install(dest string, silent, chosen bool) error {
	if !silent && !chosen {
		d, err := chooseDest(dest)
		if err != nil {
			return err
		}
		dest = d
	}
	if err := canWrite(dest); err != nil {
		return err
	}
	files, err := readPayload()
	if err != nil {
		return fmt.Errorf("the installer is damaged (%v). Download it again", err)
	}

	// Stop a HamShack that is running (any version), using the new stop script.
	tmp, err := os.MkdirTemp("", "bandwatch-setup-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	if data, ok := files["stop-bandwatch.bat"]; ok {
		stopper := filepath.Join(tmp, "stop-bandwatch.bat")
		if err := os.WriteFile(stopper, data, 0o644); err == nil {
			runStopScript(stopper, dest)
		}
	}

	if err := os.MkdirAll(dest, 0o755); err != nil {
		return fmt.Errorf("couldn't create %s: %v", dest, err)
	}
	for _, f := range oldFiles {
		_ = os.Remove(filepath.Join(dest, f))
	}
	_ = os.RemoveAll(filepath.Join(dest, "public"))
	if err := writeFiles(dest, files); err != nil {
		return err
	}

	startup := false
	if !silent {
		startup = askYesNo(title, "Start HamShack automatically when Windows starts?\n\nIt then runs in the background, ready to open from the desktop shortcut.", false)
	}
	if err := makeShortcuts(dest, startup); err != nil {
		showWarning(title, "HamShack is installed, but the shortcuts couldn't be made:\n"+err.Error()+"\n\nYou can start it with "+filepath.Join(dest, "start-bandwatch.bat"))
	}
	registerUninstall(dest, version, dirSizeKB(dest))
	removeOldCopy(dest, silent)
	checkSmartAppControl(silent)

	if silent || askYesNo(title, "HamShack by M0GLP & M3VRV is installed.\n\nUse the \"HamShack by M0GLP & M3VRV\" shortcut on your desktop or in the Start menu. It opens in your web browser.\n\nOpen HamShack now?", true) {
		openBandWatch(dest)
	}
	return nil
}

// chooseDest asks where to install: the suggested folder, or any drive or folder the user picks.
func chooseDest(suggested string) (string, error) {
	dest := suggested
	for {
		switch askInstallWhere(fmt.Sprintf("Install HamShack by M0GLP & M3VRV %s in this folder?\n\n%s\n\nYes: install there\nNo: choose another drive or folder\nCancel: don't install", versionText(), dest)) {
		case answerYes:
			return dest, nil
		case answerCancel:
			return "", errCancelled
		}
		picked := pickFolder("Choose the drive or folder for HamShack. A \"BandWatch\" folder is made inside it.")
		if picked == "" {
			continue // closed the picker: ask again
		}
		if !strings.EqualFold(filepath.Base(picked), "BandWatch") {
			picked = filepath.Join(picked, "BandWatch")
		}
		if err := canWrite(picked); err != nil {
			showWarning(title, err.Error()+"\n\nChoose another drive or folder.")
			continue
		}
		dest = picked
	}
}

// suggestedDest is where to install: where HamShack already is, except that a copy in the old
// %LOCALAPPDATA%\BandWatch folder moves to C:\BandWatch (removeOldCopy then tidies the old folder away).
func suggestedDest(previous, def string) string {
	if previous == "" {
		return def
	}
	old := filepath.Join(localAppData(), "BandWatch")
	if strings.EqualFold(filepath.Clean(previous), filepath.Clean(old)) && !strings.EqualFold(filepath.Clean(def), filepath.Clean(old)) {
		return def
	}
	return previous
}

// installedVersion reads the version of the copy in a folder (BUILD-INFO.txt), or "the version you have".
func installedVersion(dir string) string {
	b, err := os.ReadFile(filepath.Join(dir, "BUILD-INFO.txt"))
	if err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if v, ok := strings.CutPrefix(strings.TrimSpace(line), "Version "); ok && v != "" {
				return v
			}
		}
	}
	return "the version you have"
}

// defaultDest is C:\BandWatch (the system drive), or the user's own folder if that drive's top level can't be written.
func defaultDest() string {
	if d := systemDrive(); d != "" {
		p := filepath.Join(d+string(filepath.Separator), "BandWatch")
		_, statErr := os.Stat(p)
		ok := canWrite(p) == nil
		if os.IsNotExist(statErr) {
			_ = os.Remove(p) // only checking: don't leave an empty folder behind
		}
		if ok {
			return p
		}
	}
	return filepath.Join(localAppData(), "BandWatch")
}

// removeOldCopy offers to remove HamShack from the folder install.bat used, when it's now installed elsewhere.
func removeOldCopy(dest string, silent bool) {
	old := filepath.Join(localAppData(), "BandWatch")
	if strings.EqualFold(filepath.Clean(old), filepath.Clean(dest)) {
		return
	}
	if _, err := os.Stat(filepath.Join(old, "BandWatch.exe")); err != nil {
		// Only the log that older versions kept there: tidy it away without asking.
		if entries, err := os.ReadDir(old); err == nil && onlyLogs(entries) {
			_ = os.RemoveAll(old)
		}
		return
	}
	if silent || askYesNo(title, "An older copy of HamShack is in:\n"+old+"\n\nRemove it? Your settings are kept: they're in your web browser.", true) {
		_ = os.RemoveAll(old)
	}
}

// onlyLogs: the folder holds nothing but bandwatch.log files.
func onlyLogs(entries []os.DirEntry) bool {
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(strings.ToLower(e.Name()), "bandwatch.log") {
			return false
		}
	}
	return true
}

// canWrite checks HamShack can be installed in dir (it may not exist yet).
func canWrite(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("HamShack can't be installed in %s (%v). Folders like Program Files need administrator rights; your own folders or another drive (for example D:\\BandWatch) don't", dir, err)
	}
	f, err := os.CreateTemp(dir, ".bw-write-test-*")
	if err != nil {
		return fmt.Errorf("HamShack can't write to %s. Folders like Program Files need administrator rights; your own folders or another drive (for example D:\\BandWatch) don't", dir)
	}
	name := f.Name()
	f.Close()
	os.Remove(name)
	return nil
}

func readPayload() (map[string][]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return nil, err
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := filepath.ToSlash(filepath.Clean(f.Name))
		if strings.HasPrefix(name, "../") || strings.HasPrefix(name, "/") || strings.Contains(name, "/../") {
			return nil, fmt.Errorf("bad path %q", f.Name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, err
		}
		out[name] = data
	}
	if _, ok := out["BandWatch.exe"]; !ok {
		return nil, errors.New("BandWatch.exe is missing")
	}
	return out, nil
}

// writeFiles copies the app into dest. A file still in use (HamShack closing) is retried for a few seconds.
func writeFiles(dest string, files map[string][]byte) error {
	for name, data := range files {
		path := filepath.Join(dest, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		var err error
		for i := 0; i < 20; i++ {
			if err = os.WriteFile(path, data, 0o644); err == nil {
				break
			}
			time.Sleep(250 * time.Millisecond)
		}
		if err != nil {
			return fmt.Errorf("couldn't write %s (%v). Close HamShack and try again", name, err)
		}
	}
	return nil
}

func dirSizeKB(dir string) int64 {
	var n int64
	_ = filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			n += info.Size()
		}
		return nil
	})
	return n / 1024
}

func fileExists(p string) bool { st, err := os.Stat(p); return err == nil && !st.IsDir() }
