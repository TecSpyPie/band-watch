//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

const createNoWindow = 0x08000000

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	return cmd
}

func openBrowser(url string) {
	hidden(exec.Command("rundll32", "url.dll,FileProtocolHandler", url)).Start()
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
