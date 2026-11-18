package main

import (
	"testing"
	"time"
)

func TestEibiSeason(t *testing.T) {
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }
	cases := map[string]string{
		"2026-11-18T12:00:00Z": "B26",
		"2027-02-01T12:00:00Z": "B26",
		"2027-03-28T01:00:00Z": "A27", // last Sunday of March 2027
		"2027-03-27T23:00:00Z": "B26",
		"2026-10-25T00:30:00Z": "B26", // last Sunday of October 2026
		"2026-07-01T00:00:00Z": "A26",
	}
	for in, want := range cases {
		if got := eibiSeason(at(in)); got != want {
			t.Errorf("%s: got %s, want %s", in, got, want)
		}
	}
	for in, want := range map[string]string{"B26": "A26", "A27": "B26", "A00": "B99"} {
		if got := eibiPrevious(in); got != want {
			t.Errorf("previous %s: got %s, want %s", in, got, want)
		}
	}
}

func TestLatin1(t *testing.T) {
	if got := latin1([]byte{'R', 0xe1, 'd', 'i', 0xf3}); got != "Rádió" {
		t.Errorf("got %q", got)
	}
	if got := latin1([]byte("Rádió")); got != "Rádió" {
		t.Errorf("UTF-8 left alone: got %q", got)
	}
}
