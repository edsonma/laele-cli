package main

import (
	"strings"
	"testing"
)

const slang = "<SLANG>\r\n"

func newTestFilter(m Mode) *Filter {
	return NewFilter(m, func() []byte { return []byte(slang) })
}

func run(f *Filter, chunks ...string) string {
	var sb strings.Builder
	for _, c := range chunks {
		sb.Write(f.Write([]byte(c)))
	}
	sb.Write(f.Flush())
	return sb.String()
}

func TestBeforeMode(t *testing.T) {
	f := newTestFilter(ModeBefore)
	got := run(f, "$ ls\r\n", startMarker, "a\r\nb\r\n", endMarker, "$ ")
	want := "$ ls\r\n" + slang + "a\r\nb\r\n$ "
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestMiddleMode(t *testing.T) {
	f := newTestFilter(ModeMiddle)
	got := run(f, startMarker, "a\r\nb\r\nc\r\n", endMarker, "$ ")
	want := "a\r\n" + slang + "b\r\nc\r\n$ "
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestMiddleModeSingleLineGoesAfter(t *testing.T) {
	f := newTestFilter(ModeMiddle)
	got := run(f, startMarker, "only", endMarker, "$ ")
	want := "only\r\n" + slang + "$ "
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestAfterMode(t *testing.T) {
	f := newTestFilter(ModeAfter)
	got := run(f, startMarker, "a\r\nb\r\n", endMarker, "$ ")
	want := "a\r\nb\r\n" + slang + "$ "
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestNoOutputNoSlang(t *testing.T) {
	for _, m := range []Mode{ModeBefore, ModeMiddle, ModeAfter} {
		f := newTestFilter(m)
		got := run(f, startMarker, endMarker, "$ ")
		if got != "$ " {
			t.Fatalf("mode %s: got %q", m, got)
		}
	}
}

func TestMarkersSplitAcrossReads(t *testing.T) {
	f := newTestFilter(ModeBefore)
	all := startMarker + "hi\r\n" + endMarker + "$ "
	var chunks []string
	for i := 0; i < len(all); i++ { // worst case: one byte per read
		chunks = append(chunks, all[i:i+1])
	}
	got := run(f, chunks...)
	want := slang + "hi\r\n$ "
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestFullScreenProgramsAreSkipped(t *testing.T) {
	for _, m := range []Mode{ModeBefore, ModeMiddle, ModeAfter} {
		f := newTestFilter(m)
		in := "\x1b[?1049h\x1b[Hvim stuff\r\nmore\r\n\x1b[?1049l"
		got := run(f, startMarker, in, endMarker, "$ ")
		if got != in+"$ " {
			t.Fatalf("mode %s: got %q", m, got)
		}
	}
}

func TestOutputWithoutTrailingNewline(t *testing.T) {
	f := newTestFilter(ModeAfter)
	got := run(f, startMarker, "foo", endMarker, "$ ")
	want := "foo\r\n" + slang + "$ "
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestIdleBytesPassThrough(t *testing.T) {
	f := newTestFilter(ModeBefore)
	got := run(f, "prompt \x1b[1mbold\x1b[0m $ ")
	if got != "prompt \x1b[1mbold\x1b[0m $ " {
		t.Fatalf("got %q", got)
	}
}

func TestEachCommandGetsItsOwnSlang(t *testing.T) {
	f := newTestFilter(ModeBefore)
	got := run(f, startMarker, "1\r\n", endMarker, "$ ", startMarker, "2\r\n", endMarker, "$ ")
	want := slang + "1\r\n$ " + slang + "2\r\n$ "
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestForeignOSCIsPreserved(t *testing.T) {
	f := newTestFilter(ModeBefore)
	in := "\x1b]7777;something-else\a"
	if got := run(f, in); got != in {
		t.Fatalf("got %q", got)
	}
}

func TestSlangDataIsValid(t *testing.T) {
	entries, err := LoadSlang()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 17 {
		t.Fatalf("expected at least 17 terms, got %d", len(entries))
	}
	for _, e := range entries {
		if e.Term == "" || e.Meaning == "" || len(e.Phrases) == 0 {
			t.Fatalf("incomplete entry: %+v", e)
		}
	}
}

// normTerm lowercases, strips accents/punctuation and a leading "é "/"estar ",
// so "Pega a visão" and "Pegar a visão" style repeats are easy to spot.
func normTerm(s string) string {
	r := strings.NewReplacer("á", "a", "à", "a", "â", "a", "ã", "a", "é", "e", "ê", "e",
		"í", "i", "ó", "o", "ô", "o", "õ", "o", "ú", "u", "ç", "c", "-", " ", ",", " ")
	s = strings.Join(strings.Fields(r.Replace(strings.ToLower(s))), " ")
	for _, p := range []string{"e ", "estar "} {
		s = strings.TrimPrefix(s, p)
	}
	return s
}

func TestSlangTermsAreUnique(t *testing.T) {
	entries, err := LoadSlang()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]string{}
	for _, e := range entries {
		for _, variant := range strings.Split(e.Term, " / ") {
			k := normTerm(variant)
			if prev, dup := seen[k]; dup {
				t.Fatalf("duplicate term %q (already have %q)", e.Term, prev)
			}
			seen[k] = e.Term
		}
	}
}
