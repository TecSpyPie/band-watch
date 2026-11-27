package main

import "path/filepath"

// appBrowser finds Microsoft Edge or Google Chrome on Windows, the browsers that can show HamShack in
// an app window. It returns "" when neither is installed.
func appBrowser(getenv func(string) string, exists func(string) bool) string {
	var tries []string
	for _, root := range []string{getenv("ProgramFiles(x86)"), getenv("ProgramFiles"), getenv("LOCALAPPDATA")} {
		if root == "" {
			continue
		}
		tries = append(tries, filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe"))
	}
	for _, root := range []string{getenv("ProgramFiles"), getenv("ProgramFiles(x86)"), getenv("LOCALAPPDATA")} {
		if root == "" {
			continue
		}
		tries = append(tries, filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe"))
	}
	for _, p := range tries {
		if exists(p) {
			return p
		}
	}
	return ""
}

// appWindowArgs opens url as an app window: no tabs or address bar, sized for the HamShack layout.
func appWindowArgs(url string) []string {
	return []string{"--app=" + url, "--window-size=1280,860"}
}
