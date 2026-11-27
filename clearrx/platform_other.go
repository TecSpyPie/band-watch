//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func openWindow(url string) { exec.Command("xdg-open", url).Start() }

func messageBox(title, text string) { fmt.Fprintf(os.Stderr, "%s: %s\n", title, text) }

// Updates install themselves only in the Windows program.
func updateDir(string) string { return "" }

func startDetached(string) error { return nil }
