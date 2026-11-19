package main

import (
	"strings"
	"testing"
)

// The installer ends only an rtl_tcp running from the Band Watch folder, before copying files.
func TestRtlStopScript(t *testing.T) {
	s := rtlStopScript(`C:\BandWatch`)
	for _, want := range []string{"Get-Process rtl_tcp", `StartsWith('C:\BandWatch\'`, "OrdinalIgnoreCase", "Stop-Process -Force"} {
		if !strings.Contains(s, want) {
			t.Errorf("script %q is missing %q", s, want)
		}
	}
	// a trailing slash doesn't double up; a folder named C:\BandWatch2 isn't matched by C:\BandWatch\
	if got := rtlStopScript(`C:\BandWatch\`); !strings.Contains(got, `StartsWith('C:\BandWatch\'`) || strings.Contains(got, `\\'`) {
		t.Errorf("trailing slash: %q", got)
	}
	// a quote in the folder name stays inside the PowerShell string
	if got := rtlStopScript(`C:\Marvin's Apps\BandWatch`); !strings.Contains(got, `'C:\Marvin''s Apps\BandWatch\'`) {
		t.Errorf("quote: %q", got)
	}
}
