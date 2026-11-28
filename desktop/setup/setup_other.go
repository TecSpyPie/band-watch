//go:build !windows

package main

// Stand-ins so the installer can be built and tested away from Windows: no dialogs, no shortcuts.
import (
	"fmt"
	"os"
	"path/filepath"
)

func askYesNo(caption, text string, defYes bool) bool  { return defYes }
func showError(caption, text string)                   { fmt.Fprintln(os.Stderr, text) }
func showWarning(caption, text string)                 { fmt.Fprintln(os.Stderr, text) }
func localAppData() string                             { h, _ := os.UserHomeDir(); return filepath.Join(h, ".local", "share") }
func runStopScript(script, dest string)                {}
func stopClearRX(dest string)                          {}
func makeShortcuts(dest string, startup bool) error    { return nil }
func registerUninstall(dest, version string, kb int64) {}
func checkSmartAppControl(silent bool)                 {}
func openBandWatch(dest string)                        {}
func previousLocation() string                         { return "" }
func pickFolder(description string) string             { return "" }

const (
	answerYes = iota
	answerNo
	answerCancel
)

func askInstallWhere(text string) int { return answerYes }

func systemDrive() string { return "" }
