//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	mbYesNo        = 0x04
	mbYesNoCancel  = 0x03
	mbIconQuestion = 0x20
	mbIconWarning  = 0x30
	mbIconError    = 0x10
	mbIconInfo     = 0x40
	mbDefButton2   = 0x100
	idYes          = 6
	idNo           = 7
	createNoWindow = 0x08000000
)

func messageBox(caption, text string, flags uintptr) int {
	user32 := syscall.NewLazyDLL("user32.dll")
	t, _ := syscall.UTF16PtrFromString(caption)
	m, _ := syscall.UTF16PtrFromString(text)
	r, _, _ := user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
	return int(r)
}

const (
	answerYes = iota
	answerNo
	answerCancel
)

func askInstallWhere(text string) int {
	switch messageBox(title, text, mbYesNoCancel|mbIconQuestion) {
	case idYes:
		return answerYes
	case idNo:
		return answerNo
	}
	return answerCancel
}

// pickFolder shows Windows' folder picker (drives and folders, with "Make New Folder"). "" if closed.
func pickFolder(description string) string {
	script := `Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false}
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:BW_PICK_TEXT
$d.ShowNewFolderButton = $true
$d.RootFolder = 'MyComputer'
if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }`
	cmd := hidden(exec.Command("powershell", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script))
	cmd.Env = append(os.Environ(), "BW_PICK_TEXT="+description)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// previousLocation is where HamShack is already installed (from Settings > Apps), or "".
func previousLocation() string {
	out, err := hidden(exec.Command("reg", "query", uninstallKey, "/v", "InstallLocation")).Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		if i := strings.Index(line, "REG_SZ"); i >= 0 {
			p := strings.TrimSpace(line[i+len("REG_SZ"):])
			if fileExists(filepath.Join(p, "BandWatch.exe")) {
				return p
			}
		}
	}
	return ""
}

func askYesNo(caption, text string, defYes bool) bool {
	f := uintptr(mbYesNo | mbIconQuestion)
	if !defYes {
		f |= mbDefButton2
	}
	return messageBox(caption, text, f) == idYes
}

func showError(caption, text string)   { messageBox(caption, text, mbIconError) }
func showWarning(caption, text string) { messageBox(caption, text, mbIconWarning) }

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd
}

func systemDrive() string {
	if d := os.Getenv("SystemDrive"); d != "" {
		return d // usually C:
	}
	return "C:"
}

func localAppData() string {
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "AppData", "Local")
}

// runStopScript stops a running HamShack: the installed BandWatch.exe --stop, and any Node.js copy.
// ClearRX (which comes with it) is closed too, so its exe can be replaced.
func runStopScript(script, dest string) {
	for _, exe := range []string{filepath.Join(dest, "ClearRX.exe"), filepath.Join(dest, "ClearRX", "ClearRX.exe")} {
		if fileExists(exe) {
			_ = hidden(exec.Command(exe, "--stop")).Run()
		}
	}
	if exe := filepath.Join(dest, "BandWatch.exe"); fileExists(exe) {
		_ = hidden(exec.Command(exe, "--stop")).Run()
	}
	_ = hidden(exec.Command("cmd", "/c", script, "quiet")).Run()
	// An rtl_tcp left running from this folder holds its DLLs open: end it, or the copy fails.
	_ = hidden(exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", rtlStopScript(dest))).Run()
}

func makeShortcuts(dest string, startup bool) error {
	s := "no"
	if startup {
		s = "yes"
	}
	out, err := hidden(exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
		"-File", filepath.Join(dest, "make-shortcuts.ps1"), "-InstallDir", dest, "-Startup", s)).CombinedOutput()
	if err != nil {
		return &cmdError{err, strings.TrimSpace(string(out))}
	}
	return nil
}

type cmdError struct {
	err error
	out string
}

func (e *cmdError) Error() string {
	if e.out != "" {
		return e.out
	}
	return e.err.Error()
}

const uninstallKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BandWatchM3vrv`

// registerUninstall lists HamShack in Settings > Apps (for this user), with its uninstaller.
func registerUninstall(dest, version string, sizeKB int64) {
	set := func(name, typ, value string) {
		_ = hidden(exec.Command("reg", "add", uninstallKey, "/v", name, "/t", typ, "/d", value, "/f")).Run()
	}
	set("DisplayName", "REG_SZ", "HamShack by M0GLP & M3VRV")
	set("DisplayVersion", "REG_SZ", version)
	set("Publisher", "REG_SZ", "M0GLP & M3VRV")
	set("DisplayIcon", "REG_SZ", filepath.Join(dest, "bandwatch.ico"))
	set("InstallLocation", "REG_SZ", dest)
	set("UninstallString", "REG_SZ", `"`+filepath.Join(dest, "uninstall.bat")+`"`)
	set("URLInfoAbout", "REG_SZ", "https://band-watch.ample.run")
	set("NoModify", "REG_DWORD", "1")
	set("NoRepair", "REG_DWORD", "1")
	set("EstimatedSize", "REG_DWORD", strconv.FormatInt(sizeKB, 10))
	set("InstallDate", "REG_SZ", time.Now().Format("20060102")) // shown in Settings > Apps
	if buildDate != "" {
		set("Comments", "REG_SZ", "Built "+builtText())
	}
}

// checkSmartAppControl: when it's on, Windows blocks BandWatch.exe (it has no paid code-signing
// certificate) and the shortcuts run HamShack with Node.js instead. Offer Node.js if it's missing.
// Only reads the setting: changing it is the PC owner's choice, in Windows Security.
func checkSmartAppControl(silent bool) {
	out, _ := hidden(exec.Command("reg", "query", `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy`, "/v", "VerifiedAndReputablePolicyState")).Output()
	if !strings.Contains(string(out), "0x1") {
		return
	}
	if _, err := exec.LookPath("node"); err == nil || fileExists(filepath.Join(os.Getenv("ProgramFiles"), "nodejs", "node.exe")) {
		return
	}
	if silent {
		return
	}
	r := messageBox(title, "Smart App Control is on, so Windows will block BandWatch.exe: it isn't signed with a paid code-signing certificate, and Windows gives no \"Run anyway\" for it.\n\n"+
		"HamShack can run with Node.js instead (free, and signed, so Windows allows it). The HamShack shortcuts use it automatically.\n\n"+
		"Yes: install Node.js now (with winget)\n"+
		"No: open Windows Security, to turn Smart App Control off yourself\n"+
		"Cancel: do nothing for now", mbYesNoCancel|mbIconWarning)
	switch r {
	case idYes:
		cmd := exec.Command("cmd", "/c", "start", "Installing Node.js", "/wait", "cmd", "/c",
			"winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements || (echo. & echo Node.js didn't install. The download page will open. & pause & start https://nodejs.org/en/download)")
		if err := cmd.Run(); err != nil {
			_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", "https://nodejs.org/en/download").Start()
		}
	case idNo:
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", "windowsdefender://appbrowser").Start()
		messageBox(title, "In Windows Security, open \"Smart App Control settings\" and choose Off.\n\nThat lets every unsigned program run on this PC, not only HamShack. On Windows 11 25H2 and later you can turn it back on there; on older versions only by resetting Windows.", mbIconInfo)
	}
}

func openBandWatch(dest string) {
	_ = hidden(exec.Command("cmd", "/c", "start", "", "/min", filepath.Join(dest, "start-bandwatch.bat"))).Start()
}

// stopClearRX closes a running ClearRX before its files are replaced: politely first (ClearRX --stop), then for sure.
func stopClearRX(dest string) {
	for _, exe := range []string{filepath.Join(dest, "ClearRX", "ClearRX.exe"), filepath.Join(dest, "ClearRX.exe")} {
		if fileExists(exe) {
			_ = hidden(exec.Command(exe, "--stop")).Run()
		}
	}
	time.Sleep(500 * time.Millisecond)
	_ = hidden(exec.Command("taskkill", "/im", "ClearRX.exe", "/f")).Run()
}
