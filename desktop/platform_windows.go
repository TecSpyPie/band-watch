//go:build windows

package main

import (
	"os"
	"os/exec"
	"syscall"
	"unsafe"
)

const createNoWindow = 0x08000000

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd
}

// openBrowser shows Band Watch. It opens in its own app window (Edge or Chrome with --app: no address
// bar or tabs, its own taskbar button) and falls back to the default browser if neither is found or
// BANDWATCH_WINDOW=browser is set. Edge comes with Windows, and Web Serial radio control needs Edge or
// Chrome anyway.
func openBrowser(url string) {
	if os.Getenv("BANDWATCH_WINDOW") != "browser" {
		if exe := appBrowser(os.Getenv, fileExists); exe != "" {
			if hidden(exec.Command(exe, appWindowArgs(url)...)).Start() == nil {
				return
			}
		}
	}
	hidden(exec.Command("rundll32", "url.dll,FileProtocolHandler", url)).Start()
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// stopOldNodeServer stops a Band Watch 1.5 or older, which ran under Node.js.
func stopOldNodeServer() {
	script := `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ` +
		`Where-Object { $_.CommandLine -and $_.CommandLine -match 'BandWatch' -and $_.CommandLine -match 'server\.js' } | ` +
		`ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
	hidden(exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)).Run()
}

func messageBox(title, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	const mbIconWarning = 0x30
	proc.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbIconWarning)
}
