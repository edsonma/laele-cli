import '@fontsource/bagel-fat-one/latin-400.css'
import '@fontsource/spline-sans-mono/latin-400.css'
import '@fontsource/spline-sans-mono/latin-700.css'
import '@xterm/xterm/css/xterm.css'
import './style.css'

import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'

import { LineEditor } from './editor'
import { Shell } from './shell'
import { parseMode } from './slang'

const HISTORY_KEY = 'laele:history'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(-200) : []
  } catch {
    return [] // storage can be blocked (private mode, sandboxed iframes)
  }
}

function saveHistory(h: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-200)))
  } catch {
    /* ignore */
  }
}

export async function start() {
  const host = document.getElementById('terminal') as HTMLElement
  const meaning = document.getElementById('meaning') as HTMLInputElement
  const modeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="mode"]')]

  // Wait for the webfont so xterm measures the real character cell, not the fallback's.
  await Promise.race([
    Promise.all([
      document.fonts.load('400 14px "Spline Sans Mono"'),
      document.fonts.load('700 14px "Spline Sans Mono"'),
    ]),
    delay(1500),
  ])

  const small = window.matchMedia('(max-width: 40rem)').matches
  const term = new Terminal({
    fontFamily: '"Spline Sans Mono", ui-monospace, Menlo, Consolas, monospace',
    fontSize: small ? 13 : 15,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 2000,
    allowProposedApi: true,
    theme: {
      background: '#15204a',
      foreground: '#fbf3e0',
      cursor: '#ff8a2a',
      cursorAccent: '#15204a',
      selectionBackground: 'rgba(251, 243, 224, 0.3)',
      black: '#15204a',
      red: '#ff6b6b',
      green: '#3fbf9a',
      yellow: '#f0b33a',
      blue: '#7fa6ff',
      magenta: '#e58ad0',
      cyan: '#5fd3e6',
      white: '#fbf3e0',
      brightBlack: '#5b6aa0',
      brightRed: '#ff8f8f',
      brightGreen: '#5be0b4',
      brightYellow: '#ffd27a',
      brightBlue: '#9db9ff',
      brightMagenta: '#f0a8e0',
      brightCyan: '#8ee6f2',
      brightWhite: '#ffffff',
    },
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.open(host)
  fit.fit()

  const shell = new Shell()
  shell.history = loadHistory()

  const syncControls = () => {
    for (const r of modeInputs) r.checked = r.value === shell.settings.mode
    meaning.checked = shell.settings.meaning
  }
  shell.onSettings = syncControls

  const editor = new LineEditor(term, shell, {
    onHistory: saveHistory,
    onClear: () => term.write('\x1b[H\x1b[2J\x1b[3J'),
  })

  term.writeln('\x1b[1;38;2;255;138;42m🌴 laele\x1b[0m  bash com gíria de Salvador')
  term.writeln('Digite um comando e aperte Enter. Tente \x1b[1mls\x1b[0m, \x1b[1mgiria\x1b[0m ou \x1b[1mhelp\x1b[0m, viu!')
  term.writeln('')
  editor.start()

  term.onData((d) => editor.feed(d))
  term.onResize(() => editor.resize())
  new ResizeObserver(() => fit.fit()).observe(host)

  for (const r of modeInputs) {
    r.addEventListener('change', () => {
      const m = parseMode(r.value)
      if (m) shell.setSettings({ mode: m })
      term.focus()
    })
  }
  meaning.addEventListener('change', () => {
    shell.setSettings({ meaning: meaning.checked })
    term.focus()
  })

  // Suggestion chips type the command out so the visitor sees what is happening.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let typing = false
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.chips button')) {
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd
      if (!cmd || typing) return
      typing = true
      editor.feed('\x05\x15') // end of line, then kill everything before the cursor
      for (const ch of cmd) {
        editor.feed(ch)
        if (!reduceMotion) await delay(24)
      }
      editor.feed('\r')
      typing = false
      term.focus()
    })
  }

  term.focus()
  return { term, shell, editor }
}
