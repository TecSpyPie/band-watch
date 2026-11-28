package main

import (
	"regexp"
	"strings"
)

// The Android app (Play Store) is this website in Chrome without the address bar, a Trusted Web Activity.
// Android only allows that when the site lists the app at /.well-known/assetlinks.json: its package name and
// the SHA-256 of the key Google Play signs it with. The same as server.js's assetLinks: both come from the
// environment (ANDROID_PACKAGE, ANDROID_CERT_SHA256), and with no valid fingerprint the file isn't there.

const androidPackageDefault = "io.github.tecspypie.hamshack" // the same as android/twa-manifest.json

var packageRe = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$`)
var sha256Re = regexp.MustCompile(`^([0-9A-F]{2}:){31}[0-9A-F]{2}$`)

// assetLinks is the Digital Asset Links statement, or nil when the Android app isn't set up.
func assetLinks(pkg, certs string) []map[string]any {
	pkg = strings.TrimSpace(pkg)
	if pkg == "" {
		pkg = androidPackageDefault
	}
	if !packageRe.MatchString(pkg) {
		return nil
	}
	prints := []string{}
	seen := map[string]bool{}
	for _, f := range strings.Split(certs, ",") {
		f = strings.ToUpper(strings.TrimSpace(f))
		if sha256Re.MatchString(f) && !seen[f] {
			seen[f] = true
			prints = append(prints, f)
		}
	}
	if len(prints) == 0 {
		return nil
	}
	return []map[string]any{{
		"relation": []string{"delegate_permission/common.handle_all_urls"},
		"target":   map[string]any{"namespace": "android_app", "package_name": pkg, "sha256_cert_fingerprints": prints},
	}}
}
