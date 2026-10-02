package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"

	"github.com/creack/pty"
)

const version = "0.1.0"

const usage = `laele - a bash wrapper that sprinkles Gíria de Salvador on your commands, viu!

Usage:
  laele [options] [bash arguments...]

Options:
  -mode <m>     where to put the slang: before (default), middle, after, random
  -posix        run the underlying bash in POSIX mode (bash --posix)
  -meaning      also print what the slang means
  -shell <bin>  bash binary to wrap (default: bash, or $LAELE_BASH)
  -list         print every slang term and exit
  -version      print version and exit
  -h, -help     show this help

Anything else (for example -c 'ls' or a script path) is passed straight to bash
with no slang, so scripts keep working. The same happens when stdin or stdout
is not a terminal.
`

type options struct {
	mode    Mode
	shell   string
	posix   bool
	meaning bool
	list    bool
	version bool
	help    bool
	rest    []string
}

func parseArgs(args []string) (options, error) {
	o := options{mode: ModeBefore, shell: "bash"}
	if v := os.Getenv("LAELE_BASH"); v != "" {
		o.shell = v
	}

	i := 0
loop:
	for ; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			i++
			break
		}
		if !strings.HasPrefix(a, "-") {
			break
		}
		name, val, hasVal := strings.Cut(strings.TrimLeft(a, "-"), "=")

		value := func() (string, error) {
			if hasVal {
				return val, nil
			}
			if i+1 >= len(args) {
				return "", fmt.Errorf("option %s needs a value", a)
			}
			i++
			return args[i], nil
		}

		switch name {
		case "mode":
			v, err := value()
			if err != nil {
				return o, err
			}
			m, ok := ParseMode(v)
			if !ok {
				return o, fmt.Errorf("invalid mode %q (use before, middle, after or random)", v)
			}
			o.mode = m
		case "shell":
			v, err := value()
			if err != nil {
				return o, err
			}
			o.shell = v
		case "posix":
			o.posix = true
		case "meaning":
			o.meaning = true
		case "list":
			o.list = true
		case "version":
			o.version = true
		case "h", "help":
			o.help = true
		default:
			break loop // belongs to bash (-c, -l, ...)
		}
	}
	o.rest = args[i:]
	return o, nil
}

func main() {
	o, err := parseArgs(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, "laele:", err)
		os.Exit(2)
	}

	switch {
	case o.help:
		fmt.Print(usage)
		return
	case o.version:
		fmt.Println("laele", version)
		return
	case o.list:
		listSlang()
		return
	}

	if len(o.rest) > 0 || !stdinIsTTY() || !stdoutIsTTY() {
		if err := passthrough(o); err != nil {
			fmt.Fprintln(os.Stderr, "laele:", err)
			os.Exit(127)
		}
		return
	}

	code, err := runInteractive(o)
	if err != nil {
		fmt.Fprintln(os.Stderr, "laele:", err)
		os.Exit(1)
	}
	os.Exit(code)
}

func listSlang() {
	entries, err := LoadSlang()
	if err != nil {
		fmt.Fprintln(os.Stderr, "laele:", err)
		os.Exit(1)
	}
	for _, e := range entries {
		fmt.Printf("%s\n  %s\n", e.Term, e.Meaning)
		for _, p := range e.Phrases {
			fmt.Printf("  - %s\n", p)
		}
	}
}

// passthrough replaces this process with plain bash: no PTY, no slang.
func passthrough(o options) error {
	path, err := exec.LookPath(o.shell)
	if err != nil {
		return err
	}
	args := []string{o.shell}
	if o.posix {
		args = append(args, "--posix")
	}
	args = append(args, o.rest...)
	return syscall.Exec(path, args, os.Environ())
}

// rcScript installs the hooks that make bash announce when a command starts
// (PS0) and when it is back at the prompt (PROMPT_COMMAND).
func rcScript(posix bool) string {
	var b strings.Builder
	if !posix {
		b.WriteString("[ -f \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\n")
	}
	b.WriteString(`__laele_pc() { local s=$?; printf '\033]7777;laele-end\007'; return $s; }
PROMPT_COMMAND="__laele_pc${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
PS0='\e]7777;laele-start\a'"${PS0}"
`)
	return b.String()
}

func runInteractive(o options) (int, error) {
	entries, err := LoadSlang()
	if err != nil {
		return 1, err
	}
	shellPath, err := exec.LookPath(o.shell)
	if err != nil {
		return 1, err
	}

	rc, err := os.CreateTemp("", "laele-rc-*.sh")
	if err != nil {
		return 1, err
	}
	defer os.Remove(rc.Name())
	if _, err := rc.WriteString(rcScript(o.posix)); err != nil {
		return 1, err
	}
	rc.Close()

	cmd := exec.Command(shellPath)
	cmd.Env = append(os.Environ(), "LAELE=1")
	if o.posix {
		cmd.Args = append(cmd.Args, "--posix", "-i")
		cmd.Env = append(cmd.Env, "ENV="+rc.Name())
	} else {
		cmd.Args = append(cmd.Args, "--rcfile", rc.Name(), "-i")
	}

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return 1, err
	}
	defer ptmx.Close()

	_ = pty.InheritSize(os.Stdin, ptmx)
	winch := make(chan os.Signal, 1)
	signal.Notify(winch, syscall.SIGWINCH)
	go func() {
		for range winch {
			_ = pty.InheritSize(os.Stdin, ptmx)
		}
	}()

	restore, err := makeRaw()
	if err != nil {
		return 1, err
	}
	defer restore()

	go func() { _, _ = io.Copy(ptmx, os.Stdin) }()

	filter := NewFilter(o.mode, NewLiner(entries, o.meaning))
	buf := make([]byte, 32*1024)
	for {
		n, err := ptmx.Read(buf)
		if n > 0 {
			_, _ = os.Stdout.Write(filter.Write(buf[:n]))
		}
		if err != nil { // EIO once bash exits
			break
		}
	}
	_, _ = os.Stdout.Write(filter.Flush())

	_ = cmd.Wait()
	ws, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if ok && ws.Signaled() {
		return 128 + int(ws.Signal()), nil
	}
	return cmd.ProcessState.ExitCode(), nil
}

// --- terminal helpers (stty keeps this portable across Linux and macOS
// without pulling in golang.org/x/term) ---

func stty(args ...string) error {
	c := exec.Command("stty", args...)
	c.Stdin = os.Stdin
	return c.Run()
}

func stdinIsTTY() bool { return stty("-g") == nil }

func stdoutIsTTY() bool {
	fi, err := os.Stdout.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

func makeRaw() (func(), error) {
	c := exec.Command("stty", "-g")
	c.Stdin = os.Stdin
	saved, err := c.Output()
	if err != nil {
		return func() {}, err
	}
	if err := stty("raw", "-echo"); err != nil {
		return func() {}, err
	}
	state := strings.TrimSpace(string(saved))
	return func() { _ = stty(state) }, nil
}
