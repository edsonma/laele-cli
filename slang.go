package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math/rand"
)

//go:embed slang.json
var slangJSON []byte

// Entry is one Gíria de Salvador term with its meaning and example phrases.
type Entry struct {
	Term    string   `json:"term"`
	Meaning string   `json:"meaning"`
	Phrases []string `json:"phrases"`
}

func LoadSlang() ([]Entry, error) {
	var entries []Entry
	if err := json.Unmarshal(slangJSON, &entries); err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("slang.json is empty")
	}
	return entries, nil
}

// NewLiner returns a function that builds a random, colored slang line
// terminated by CRLF (the terminal is in raw mode, so a bare \n won't do).
func NewLiner(entries []Entry, showMeaning bool) func() []byte {
	return func() []byte {
		e := entries[rand.Intn(len(entries))]
		phrase := e.Term + ", viu!"
		if len(e.Phrases) > 0 {
			phrase = e.Phrases[rand.Intn(len(e.Phrases))]
		}
		s := fmt.Sprintf("\x1b[1;33m🌴 %s\x1b[0m\r\n", phrase)
		if showMeaning {
			s += fmt.Sprintf("\x1b[2m   ↳ %s: %s\x1b[0m\r\n", e.Term, e.Meaning)
		}
		return []byte(s)
	}
}
