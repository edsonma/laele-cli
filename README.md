# laele-cli 🌴

A bash wrapper that sprinkles **Gíria de Salvador** on your commands, viu!

```
$ ls
🌴 Mainha, esse comando é barril, viu!
Makefile  README.md  main.go
```

`laele` runs your real `bash` inside a pseudo-terminal, so everything bash does
still works (history, completion, job control, your `~/.bashrc`). The only
difference is that a slang line is inserted into the output of each command.

## Install

Requires Go 1.22+ and **bash 4.4+** (needs `PS0`).

```fish
git clone https://github.com/edsonma/laele-cli.git
cd laele-cli
make install            # puts `laele` in ~/.local/bin
fish_add_path ~/.local/bin
```

macOS ships bash 3.2, which is too old. Install a newer one and point laele at it:

```fish
brew install bash
set -Ux LAELE_BASH (brew --prefix)/bin/bash
```

## Usage

```
laele [options] [bash arguments...]

  -mode <m>     before (default) | middle | after | random
  -posix        run bash in POSIX mode (bash --posix)
  -meaning      also print what the slang means
  -shell <bin>  bash binary to wrap (default: bash, or $LAELE_BASH)
  -list         print every slang term
```

Where the slang goes, for `echo a; echo b; echo c`:

| mode     | result                          |
|----------|---------------------------------|
| `before` | slang, a, b, c                  |
| `middle` | a, slang, b, c                  |
| `after`  | a, b, c, slang                  |
| `random` | one of the above per command    |

### What it deliberately does not touch

- **Full-screen programs** (`vim`, `less`, `top`, `htop`, `nano`): detected via the
  alternate screen buffer, so the display is never corrupted.
- **Commands with no output** (`cd`, `true`): no slang.
- **Scripts and pipes**: `laele -c '...'`, `laele script.sh`, or piped stdin skip the
  wrapper and `exec` plain bash, so nothing in your automation gets slang.
- **Exit codes**: `$?` is preserved, and laele exits with bash's exit status.

## How it works

1. `laele` starts bash in a PTY with a tiny generated rc file (it sources your
   `~/.bashrc` first) that sets `PS0` and `PROMPT_COMMAND` to print private OSC
   markers (`ESC ] 7777 ; laele-start/laele-end BEL`).
2. The output filter (`filter.go`) strips those markers from the stream. Between
   *start* and *end* it knows a command is running and inserts the slang line.
3. Everything else is forwarded byte for byte.

The filter is a pure bytes-in/bytes-out state machine, covered by unit tests
(`make test`), including markers split across reads.

The slang list lives in `slang.json` (term, meaning, example phrases) so the
upcoming web version can share it.

## Roadmap

- [x] Go CLI
- [ ] Web version (xterm.js + a fake in-browser shell sharing `slang.json`)

## Português

`laele` é um bash "turbinado": a cada comando, solta uma gíria de Salvador no
meio da saída. É barril, viu! Use `laele -list` pra ver todas as gírias.
