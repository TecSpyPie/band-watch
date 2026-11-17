//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func openBrowser(url string) { exec.Command("xdg-open", url).Start() }

func stopOldNodeServer() {}

func messageBox(title, text string) { fmt.Fprintf(os.Stderr, "%s: %s\n", title, text) }

func hidden(cmd *exec.Cmd) *exec.Cmd { return cmd }
