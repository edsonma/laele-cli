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

The slang list lives in `slang.json` (term, meaning, example phrases) and is shared by the
CLI and the web version.

## Web version

`web/` is a browser version of the same joke: a terminal (xterm.js) in front of a small
**fake shell written in TypeScript**. It is not real bash, since a website can't safely run
one for every visitor. It has a virtual filesystem and the usual commands (`ls`, `cd`, `cat`,
`grep`, `sort`, `head`, `tail`, `wc`, `cp`, `mv`, `rm`, `mkdir`, `touch`, `echo`, ...),
pipes, `&&` / `||` / `;`, `>` / `>>`, quotes, `$VARS`, globs, history and Tab completion.

It uses the same `slang.json` and the same placement rules as the CLI (`before`, `middle`,
`after`, `random`), switchable from the page or with `laele -mode <m>` typed in the terminal.
The page also shows three original SVG illustrations (capoeira, Pelourinho, acarajé), drawn
inline in `web/index.html`, so there are no image files to host or license.
Extra commands: `giria [termo]` (search the slang, accent-insensitive) and `giria -r`.

```fish
make web-install   # npm ci
make web-dev       # dev server with hot reload
make web-test      # unit tests + type check
make web-build     # static site in web/dist
```

The build is plain static files with relative URLs, so it works on GitHub Pages (including
under `/laele-cli/`), Netlify, Vercel or any static host. The Vite project must be built from a
full checkout because it imports `../slang.json`.

To publish on GitHub Pages: in the repo settings set **Pages -> Source** to *GitHub Actions*,
then add the ready-made workflow and run it from the Actions tab:

```fish
mkdir -p .github/workflows
git mv web/deploy/pages.yml .github/workflows/pages.yml
git commit -m "Add Pages deploy workflow"; and git push
```

(It is kept under `web/deploy/` because pushing files into `.github/workflows` needs a token
with the `workflow` scope.)

## Deploy on Railway

The repo root has a `Dockerfile` and a `railway.json`. Railway builds the web version and
serves the static files with Caddy on the port it provides in `$PORT`.

In the dashboard:

1. **New Project -> Deploy from GitHub repo** and pick `edsonma/laele-cli` (authorize the
   Railway GitHub app if it asks).
2. Leave **Root Directory** empty. Do not set it to `web/`: the build needs `slang.json`, which
   lives at the repo root.
3. When the first deploy is green, open the service -> **Settings -> Networking -> Generate
   Domain**.

Or from the terminal:

```fish
npm install -g @railway/cli
railway login
railway init
railway up
railway domain
```

To try the same container locally: `make docker-run`, then open http://localhost:8080.

## Roadmap

- [x] Go CLI
- [x] Web version (xterm.js + a fake in-browser shell sharing `slang.json`)

## Português

`laele` é um bash "turbinado": a cada comando, solta uma gíria de Salvador no
meio da saída. É barril, viu! Use `laele -list` pra ver todas as gírias.
