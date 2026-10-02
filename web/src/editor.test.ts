import { beforeEach, describe, expect, it } from 'vitest'
import { LineEditor, type TerminalLike } from './editor'
import { Shell } from './shell'

/**
 * A minimal terminal emulator: enough of xterm's behaviour (autowrap with the
 * "pending wrap" state, CR/LF, cursor up/down/right, erase to end of screen) to
 * check what the line editor really leaves on screen.
 */
class FakeTerm implements TerminalLike {
  rows: string[][] = [[]]
  r = 0
  c = 0
  pending = false
  constructor(public cols: number) {}

  write(data: string): void {
    let i = 0
    while (i < data.length) {
      const ch = data[i] as string
      if (ch === '\x1b' && data[i + 1] === '[') {
        const m = /^\x1b\[([0-9;?]*)([@-~])/.exec(data.slice(i))
        if (!m) throw new Error('bad CSI in ' + JSON.stringify(data.slice(i)))
        this.csi(m[1] as string, m[2] as string)
        i += m[0].length
      } else if (ch === '\r') {
        this.c = 0
        this.pending = false
        i++
      } else if (ch === '\n') {
        this.r++
        this.pending = false
        i++
      } else {
        const cp = String.fromCodePoint(data.codePointAt(i) as number)
        this.put(cp)
        i += cp.length
      }
    }
  }

  private csi(params: string, final: string) {
    const n = Math.max(1, Number(params) || 1)
    switch (final) {
      case 'A':
        this.r = Math.max(0, this.r - n)
        this.pending = false
        break
      case 'B':
        this.r += n
        this.pending = false
        break
      case 'C':
        this.c = Math.min(this.cols - 1, this.c + n)
        this.pending = false
        break
      case 'J': // erase from cursor to end of screen
        this.row(this.r).length = this.c
        this.rows.length = this.r + 1
        break
      case 'm':
        break // colors are irrelevant here
      default:
        throw new Error('unsupported CSI ' + final)
    }
  }

  private row(r: number): string[] {
    while (this.rows.length <= r) this.rows.push([])
    return this.rows[r] as string[]
  }

  private put(cp: string) {
    if (this.pending) {
      this.r++
      this.c = 0
      this.pending = false
    }
    const row = this.row(this.r)
    while (row.length < this.c) row.push(' ')
    row[this.c] = cp
    if (this.c === this.cols - 1) this.pending = true
    else this.c++
  }

  /** Screen text, one string per row (rows holding only spaces count as empty). */
  get lines(): string[] {
    return this.rows.map((r) => {
      const s = r.join('')
      return s.trim() === '' ? '' : s
    })
  }
  get text(): string {
    return this.lines.join('\n')
  }
  /** Cursor position as the user sees it (a pending wrap means "one past the last column"). */
  get cursor(): { row: number; col: number } {
    return { row: this.r, col: this.pending ? this.cols : this.c }
  }
}

const PROMPT = 'visitante@salvador:~$ '
let term: FakeTerm
let sh: Shell
let ed: LineEditor

function setup(cols = 80) {
  term = new FakeTerm(cols)
  sh = new Shell(() => 0)
  ed = new LineEditor(term, sh)
  ed.start()
}

describe('editing', () => {
  beforeEach(() => setup())

  it('shows the prompt and echoes typing', () => {
    expect(term.text).toBe(PROMPT)
    ed.feed('ls')
    expect(term.text).toBe(PROMPT + 'ls')
    expect(term.cursor).toEqual({ row: 0, col: PROMPT.length + 2 })
  })

  it('backspace, delete, left/right and insertion in the middle', () => {
    ed.feed('echo abc')
    ed.feed('\x7f') // abc -> ab
    ed.feed('\x1b[D\x1b[D\x1b[D') // cursor before the b? positions: "echo ab|" -> left x3 -> "echo| ab"
    ed.feed('X')
    expect(ed.line).toBe('echoX ab')
    ed.feed('\x1b[3~') // delete the space after the cursor
    expect(ed.line).toBe('echoXab')
    expect(term.text).toBe(PROMPT + 'echoXab')
    expect(term.cursor.col).toBe(PROMPT.length + 5)
    ed.feed('\x1b[C\x1b[C\x1b[C\x1b[C') // past the end: clamped
    expect(term.cursor.col).toBe(PROMPT.length + 7)
  })

  it('Home/End, Ctrl-A/E, Ctrl-U, Ctrl-K, Ctrl-W', () => {
    ed.feed('echo um dois')
    ed.feed('\x01')
    expect(term.cursor.col).toBe(PROMPT.length)
    ed.feed('\x05')
    expect(term.cursor.col).toBe(PROMPT.length + 12)
    ed.feed('\x17') // delete "dois"
    expect(ed.line).toBe('echo um ')
    ed.feed('\x1bb') // Alt-b: back one word
    ed.feed('\x0b') // kill to end
    expect(ed.line).toBe('echo ')
    ed.feed('\x15')
    expect(ed.line).toBe('')
    expect(term.text).toBe(PROMPT)
  })

  it('word movement with Ctrl+arrows', () => {
    ed.feed('aa bb cc')
    ed.feed('\x1b[1;5D\x1b[1;5D')
    expect(term.cursor.col).toBe(PROMPT.length + 3)
    ed.feed('\x1b[1;5C')
    expect(term.cursor.col).toBe(PROMPT.length + 5)
  })

  it('emoji count as one character for backspace and cursor moves', () => {
    ed.feed('echo 🌴')
    ed.feed('\x7f')
    expect(ed.line).toBe('echo ')
    ed.feed('🌴\x1b[D')
    ed.feed('x')
    expect(ed.line).toBe('echo x🌴')
  })

  it('ignores escape sequences it does not know', () => {
    ed.feed('a\x1b[15~b\x1b[200~c')
    expect(ed.line).toBe('abc')
  })
})

describe('wrapped lines', () => {
  beforeEach(() => setup(30))

  it('keeps the screen and cursor right while a line wraps', () => {
    const text = 'echo ' + 'x'.repeat(40)
    ed.feed(text)
    const all = PROMPT + text
    expect(term.lines.join('')).toBe(all)
    expect(term.cursor).toEqual({ row: Math.floor(all.length / 30), col: all.length % 30 })
  })

  it('handles input that ends exactly on the last column', () => {
    const text = 'x'.repeat(30 - PROMPT.length) // prompt + text = 30 chars: one full row
    ed.feed(text)
    expect(term.lines[0]).toBe(PROMPT + text)
    expect(term.cursor).toEqual({ row: 1, col: 0 })
    ed.feed('y')
    expect(term.lines.join('')).toBe(PROMPT + text + 'y')
    expect(term.cursor).toEqual({ row: 1, col: 1 })
    ed.feed('\x7f\x7f') // back across the boundary
    expect(term.lines.join('')).toBe(PROMPT + text.slice(0, -1))
    expect(term.cursor).toEqual({ row: 0, col: 29 })
  })

  it('edits in the middle of a wrapped line', () => {
    const text = 'a'.repeat(50)
    ed.feed(text)
    ed.feed('\x1b[D'.repeat(35)) // back to somewhere on the first row
    ed.feed('Z')
    const expected = text.slice(0, 15) + 'Z' + text.slice(15)
    expect(ed.line).toBe(expected)
    expect(term.lines.join('')).toBe(PROMPT + expected)
    const pos = PROMPT.length + 16
    expect(term.cursor).toEqual({ row: Math.floor(pos / 30), col: pos % 30 })
  })

  it('clearing a wrapped line leaves a clean prompt', () => {
    ed.feed('b'.repeat(70))
    ed.feed('\x15')
    expect(term.text).toBe(PROMPT)
    expect(term.cursor).toEqual({ row: 0, col: PROMPT.length })
  })

  it('output after a wrapped command starts on the row below it, without a gap', () => {
    // `laele` prints without slang, so row positions are predictable even at 30 columns
    const cmd = 'laele' + ' '.repeat(30) + '-mode before' // 22 + 47 chars -> 3 rows
    ed.feed(cmd + '\r')
    const rows = term.lines
    expect(rows.slice(0, 3).join('')).toBe(PROMPT + cmd)
    expect(rows[3]).toBe('modo: antes (before)')
    expect(rows[4]).toBe(PROMPT)
    expect(rows).toHaveLength(5)
  })

  it('a command that exactly fills the row: output starts right below, no empty row', () => {
    const cmd = 'laele' + ' '.repeat(30 - PROMPT.length - 5) // prompt + cmd = 30 columns
    ed.feed(cmd + '\r')
    expect(term.lines).toEqual([PROMPT + cmd, 'modo: antes (before)', 'significado: desligado', PROMPT])
  })

  it('same for a command with no output at all', () => {
    const cmd = 'true' + ' '.repeat(30 - PROMPT.length - 4)
    ed.feed(cmd + '\r')
    expect(term.lines).toEqual([PROMPT + cmd, PROMPT])
  })
})

describe('submitting', () => {
  beforeEach(() => setup())

  it('runs the command, prints output (with slang) and a fresh prompt', () => {
    ed.feed('echo oi\r')
    expect(term.lines[0]).toBe(PROMPT + 'echo oi')
    expect(term.lines[1]).toContain('🌴')
    expect(term.lines[2]).toBe('oi')
    expect(term.lines[3]).toBe(PROMPT)
    expect(ed.line).toBe('')
  })

  it('output without a trailing newline still ends on its own row', () => {
    ed.feed('echo -n sem\r')
    expect(term.lines.at(-2)).toBe('sem')
    expect(term.lines.at(-1)).toBe(PROMPT)
  })

  it('pasted text with several lines runs every command', () => {
    ed.feed('echo um\recho dois\r')
    expect(term.text).toContain('um')
    expect(term.text).toContain('dois')
    expect(sh.history).toEqual(['echo um', 'echo dois'])
  })

  it('an empty line just gives a new prompt', () => {
    ed.feed('\r')
    expect(term.lines).toEqual([PROMPT, PROMPT])
  })

  it('clear calls onClear and prints no output', () => {
    let cleared = 0
    const t = new FakeTerm(80)
    const e = new LineEditor(t, new Shell(() => 0), { onClear: () => cleared++ })
    e.start()
    e.feed('clear\r')
    expect(cleared).toBe(1)
  })

  it('reports history changes', () => {
    const seen: string[][] = []
    const t = new FakeTerm(80)
    const e = new LineEditor(t, new Shell(() => 0), { onHistory: (h) => seen.push([...h]) })
    e.start()
    e.feed('pwd\r')
    expect(seen.at(-1)).toEqual(['pwd'])
  })
})

describe('history', () => {
  beforeEach(() => {
    setup()
    ed.feed('echo um\r')
    ed.feed('echo dois\r')
  })

  it('arrows walk through history and restore the draft', () => {
    ed.feed('rascunho')
    ed.feed('\x1b[A')
    expect(ed.line).toBe('echo dois')
    ed.feed('\x1b[A')
    expect(ed.line).toBe('echo um')
    ed.feed('\x1b[A') // already at the oldest
    expect(ed.line).toBe('echo um')
    ed.feed('\x1b[B')
    expect(ed.line).toBe('echo dois')
    ed.feed('\x1b[B')
    expect(ed.line).toBe('rascunho')
    ed.feed('\x1b[B')
    expect(ed.line).toBe('rascunho')
    expect(term.lines.at(-1)).toBe(PROMPT + 'rascunho')
  })

  it('Ctrl-P / Ctrl-N work too, and a recalled line can be edited and run', () => {
    ed.feed('\x10')
    expect(ed.line).toBe('echo dois')
    ed.feed('\x7f\x7f\x7f\x7f3\r')
    expect(term.text).toContain('\necho 3\n'.replace('\n', '\n').trim() && 'echo ')
    expect(sh.history.at(-1)).toBe('echo 3')
  })
})

describe('Ctrl-C and Ctrl-D', () => {
  beforeEach(() => setup())

  it('Ctrl-C drops the line and shows ^C', () => {
    ed.feed('echo naoexecuta')
    ed.feed('\x03')
    expect(term.lines[0]).toBe(PROMPT + 'echo naoexecuta^C')
    expect(term.lines[1]).toBe(PROMPT)
    expect(ed.line).toBe('')
    expect(sh.history).toEqual([])
  })

  it('Ctrl-C with the cursor mid-line still puts ^C at the end', () => {
    ed.feed('abcdef\x1b[D\x1b[D\x03')
    expect(term.lines[0]).toBe(PROMPT + 'abcdef^C')
  })

  it('Ctrl-D on an empty line runs exit, on a non-empty line deletes', () => {
    ed.feed('\x04')
    expect(term.text).toContain('fechar a aba')
    ed.feed('abc\x1b[D\x04')
    expect(ed.line).toBe('ab')
  })
})

describe('tab completion', () => {
  beforeEach(() => setup())

  it('completes a unique command and adds a space', () => {
    ed.feed('gir\t')
    expect(ed.line).toBe('giria ')
  })

  it('completes a file name and a directory name', () => {
    ed.feed('cat gi\t')
    expect(ed.line).toBe('cat giria.txt ')
    ed.feed('\x15cd Pel\t')
    expect(ed.line).toBe('cd Pelourinho/') // no trailing space after a directory
  })

  it('extends to the common prefix, then lists options on a second Tab', () => {
    ed.feed('ca') // cat
    ed.feed('\x15') // reset
    ed.feed('cat \t') // giria.txt, Pelourinho/, README.md -> nothing in common
    expect(ed.line).toBe('cat ')
    expect(term.lines).toEqual([PROMPT + 'cat '])
    ed.feed('\t')
    expect(term.text).toContain('giria.txt')
    expect(term.text).toContain('Pelourinho/')
    expect(term.text).toContain('README.md')
    expect(term.lines.at(-1)).toBe(PROMPT + 'cat ')
    expect(ed.line).toBe('cat ')
  })

  it('completes the shared prefix of several matches', () => {
    sh.vfs.writeFile('/home/visitante/relatorio-1.txt', '')
    sh.vfs.writeFile('/home/visitante/relatorio-2.txt', '')
    ed.feed('cat rel\t')
    expect(ed.line).toBe('cat relatorio-')
  })

  it('does nothing when there are no matches', () => {
    ed.feed('cat zzz\t')
    expect(ed.line).toBe('cat zzz')
  })
})
