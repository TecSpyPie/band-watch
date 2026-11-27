package main

import "strings"

// rtlStopScript is the PowerShell that ends any rtl_tcp running from the HamShack folder, so its files
// (rtl_tcp.exe, rtlsdr.dll, pthreadVC2.dll) can be replaced. One is left running when HamShack was stopped
// suddenly (Task Manager, a crash) instead of quitting, and the update then fails with "being used by another
// process". rtl_tcp running from anywhere else (another SDR program's copy) is left alone.
func rtlStopScript(dest string) string {
	dir := strings.TrimRight(dest, `\/`) + `\`
	dir = strings.ReplaceAll(dir, "'", "''") // a quote in the folder name, inside a PowerShell '…' string
	return "Get-Process rtl_tcp -ErrorAction SilentlyContinue | " +
		"Where-Object { $_.Path -and $_.Path.StartsWith('" + dir + "', [StringComparison]::OrdinalIgnoreCase) } | " +
		"Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 400"
}
