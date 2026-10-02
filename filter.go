package main

import (
	"bytes"
	"math/rand"
)

// Markers are emitted by the wrapped bash (via PS0 and PROMPT_COMMAND) as
// private OSC sequences. The Filter strips them from the stream and uses them
// to know when a command starts and ends running.
const (
	oscPrefix   = "\x1b]7777;"
	startMarker = oscPrefix + "laele-start\a"
	endMarker   = oscPrefix + "laele-end\a"
)

// Mode decides where the slang line is inserted relative to a command's output.
type Mode string

const (
	ModeBefore Mode = "before" // before the first byte of output (default)
	ModeMiddle Mode = "middle" // after the first line of output
	ModeAfter  Mode = "after"  // after the last byte of output
	ModeRandom Mode = "random" // pick one of the above for every command
)

// ParseMode validates a user supplied mode string.
func ParseMode(s string) (Mode, bool) {
	switch m := Mode(s); m {
	case ModeBefore, ModeMiddle, ModeAfter, ModeRandom:
		return m, true
	}
	return "", false
}

// Filter sits between bash's PTY and the real terminal. It is a pure
// bytes-in/bytes-out state machine so it can be unit tested without a PTY.
type Filter struct {
	mode Mode
	line func() []byte // returns a full slang line, including trailing CRLF

	cmdMode   Mode // mode resolved for the command currently running
	running   bool
	injected  bool
	skip      bool // full-screen program detected: never inject
	sawOutput bool
	lastByte  byte
	carry     []byte // bytes held back because they may be a split marker
}

func NewFilter(mode Mode, line func() []byte) *Filter {
	return &Filter{mode: mode, line: line}
}

// Write consumes a chunk of terminal output and returns what should be shown.
func (f *Filter) Write(p []byte) []byte {
	buf := append(f.carry, p...)
	f.carry = nil
	var out []byte

	for len(buf) > 0 {
		i := bytes.Index(buf, []byte(oscPrefix))
		if i < 0 {
			keep := partialPrefixLen(buf)
			out = append(out, f.data(buf[:len(buf)-keep])...)
			f.carry = append([]byte(nil), buf[len(buf)-keep:]...)
			return out
		}

		out = append(out, f.data(buf[:i])...)
		rest := buf[i:]
		j := bytes.IndexByte(rest, '\a')
		if j < 0 {
			if len(rest) > 64 { // not one of ours, stop waiting for a terminator
				out = append(out, f.data(rest[:len(oscPrefix)])...)
				buf = rest[len(oscPrefix):]
				continue
			}
			f.carry = append([]byte(nil), rest...)
			return out
		}

		seq := rest[:j+1]
		buf = rest[j+1:]
		switch string(seq) {
		case startMarker:
			f.start()
		case endMarker:
			out = append(out, f.end()...)
		default:
			out = append(out, f.data(seq)...)
		}
	}
	return out
}

// Flush returns any bytes still held back; call it when the stream closes.
func (f *Filter) Flush() []byte {
	out := f.carry
	f.carry = nil
	return out
}

func (f *Filter) start() {
	f.running = true
	f.injected = false
	f.skip = false
	f.sawOutput = false
	f.lastByte = 0
	f.cmdMode = f.mode
	if f.mode == ModeRandom {
		f.cmdMode = []Mode{ModeBefore, ModeMiddle, ModeAfter}[rand.Intn(3)]
	}
}

func (f *Filter) end() []byte {
	var out []byte
	if f.running && !f.injected && !f.skip && f.sawOutput &&
		(f.cmdMode == ModeMiddle || f.cmdMode == ModeAfter) {
		if f.lastByte != '\n' {
			out = append(out, '\r', '\n')
		}
		out = append(out, f.line()...)
	}
	f.running = false
	return out
}

// data handles plain terminal bytes (no markers inside).
func (f *Filter) data(b []byte) []byte {
	if len(b) == 0 {
		return nil
	}
	if !f.running {
		return b
	}
	f.sawOutput = true
	f.lastByte = b[len(b)-1]
	if !f.skip && hasAltScreen(b) {
		f.skip = true
	}
	if f.skip || f.injected {
		return b
	}

	switch f.cmdMode {
	case ModeBefore:
		f.injected = true
		return append(f.line(), b...)
	case ModeMiddle:
		if i := bytes.IndexByte(b, '\n'); i >= 0 {
			f.injected = true
			out := make([]byte, 0, len(b)+64)
			out = append(out, b[:i+1]...)
			out = append(out, f.line()...)
			return append(out, b[i+1:]...)
		}
	}
	return b
}

// hasAltScreen reports whether b switches the terminal to the alternate
// screen buffer, which is what vim, less, top, htop, nano, etc. do.
func hasAltScreen(b []byte) bool {
	for _, s := range []string{"\x1b[?1049h", "\x1b[?1047h", "\x1b[?47h"} {
		if bytes.Contains(b, []byte(s)) {
			return true
		}
	}
	return false
}

// partialPrefixLen returns the length of the longest proper prefix of
// oscPrefix that b ends with, so a marker split across reads isn't leaked.
func partialPrefixLen(b []byte) int {
	for k := len(oscPrefix) - 1; k > 0; k-- {
		if k <= len(b) && bytes.HasSuffix(b, []byte(oscPrefix[:k])) {
			return k
		}
	}
	return 0
}
