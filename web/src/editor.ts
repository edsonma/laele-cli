import { columns } from './commands'
import type { Shell } from './shell'

/** The small surface of xterm.js the editor needs; lets tests use a fake. */
export interface TerminalLike {
  write(data: string): void
  readonly cols: number
}

// Matches CSI (ESC [ ... final), SS3 (ESC O x) and Alt+b / Alt+f.
const ESCAPE = /^\x1b(\[[0-9;?]*[ -/]*[@-~]|O[@-~]|[bf])/

const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff

export class LineEditor {
  private buf = ''
  private cur = 0
  private histIdx: number
  private draft = ''
  private cursorRow = 0 // rows between the prompt's first row and the cursor
  private prompt: { text: string; length: number }
  private lastTabAmbiguous = false

  constructor(
    private term: TerminalLike,
    private shell: Shell,
    private opts: { onHistory?: (h: string[]) => void; onClear?: () => void } = {},
  ) {
    this.histIdx = shell.history.length
    this.prompt = shell.prompt()
  }

  get line(): string {
    return this.buf
  }

  start(): void {
    this.showPrompt()
  }

  /** Feed raw terminal input (keystrokes or pasted text). */
  feed(data: string): void {
    let i = 0
    while (i < data.length) {
      const ch = data[i] as string
      if (ch === '\x1b') {
        const m = ESCAPE.exec(data.slice(i))
        if (m) {
          this.escape(m[0])
          i += m[0].length
        } else i++
        continue
      }
      // keep surrogate pairs together so emoji paste as one character
      const code = data.charCodeAt(i)
      const unit = isHigh(code) && i + 1 < data.length ? data.slice(i, i + 2) : ch
      i += unit.length
      this.key(unit)
    }
  }

  /** Re-draw after the terminal width changed. */
  resize(): void {
    this.cursorRow = Math.floor((this.prompt.length + this.cur) / Math.max(1, this.term.cols))
    this.render()
  }

  // ------------------------------------------------------------ input handling

  private key(c: string): void {
    this.noteTab(c)
    switch (c) {
      case '\r':
      case '\n':
        return this.submit()
      case '\x7f':
      case '\b':
        return this.backspace()
      case '\x03':
        return this.interrupt()
      case '\x04':
        if (this.buf === '') {
          this.buf = 'exit'
          this.cur = 4
          this.render()
          return this.submit()
        }
        return this.deleteForward()
      case '\x01':
        return this.moveTo(0)
      case '\x05':
        return this.moveTo(this.buf.length)
      case '\x02':
        return this.moveTo(this.cur - this.stepBack(this.cur))
      case '\x06':
        return this.moveTo(this.cur + this.stepFwd(this.cur))
      case '\x0b':
        this.buf = this.buf.slice(0, this.cur)
        return this.render()
      case '\x15':
        this.buf = this.buf.slice(this.cur)
        this.cur = 0
        return this.render()
      case '\x17':
        return this.killWord()
      case '\x0c':
        this.opts.onClear?.()
        this.cursorRow = 0
        return this.render()
      case '\x10':
        return this.history(-1)
      case '\x0e':
        return this.history(1)
      case '\t':
        return this.tab()
      default:
        if (c >= ' ' && c !== '\x7f') this.insert(c)
    }
  }

  private escape(seq: string): void {
    this.noteTab('')
    switch (seq) {
      case '\x1b[A':
        return this.history(-1)
      case '\x1b[B':
        return this.history(1)
      case '\x1b[C':
        return this.moveTo(this.cur + this.stepFwd(this.cur))
      case '\x1b[D':
        return this.moveTo(this.cur - this.stepBack(this.cur))
      case '\x1b[H':
      case '\x1bOH':
      case '\x1b[1~':
        return this.moveTo(0)
      case '\x1b[F':
      case '\x1bOF':
      case '\x1b[4~':
        return this.moveTo(this.buf.length)
      case '\x1b[3~':
        return this.deleteForward()
      case '\x1b[1;5D':
      case '\x1b[1;3D':
      case '\x1bb':
        return this.moveTo(this.wordStart(this.cur))
      case '\x1b[1;5C':
      case '\x1b[1;3C':
      case '\x1bf':
        return this.moveTo(this.wordEnd(this.cur))
    }
  }

  private noteTab(c: string): void {
    if (c !== '\t') this.lastTabAmbiguous = false
  }

  private stepBack(pos: number): number {
    return pos >= 2 && isLow(this.buf.charCodeAt(pos - 1)) && isHigh(this.buf.charCodeAt(pos - 2)) ? 2 : Math.min(1, pos)
  }
  private stepFwd(pos: number): number {
    return pos + 1 < this.buf.length && isHigh(this.buf.charCodeAt(pos)) && isLow(this.buf.charCodeAt(pos + 1))
      ? 2
      : Math.min(1, this.buf.length - pos)
  }

  private wordStart(pos: number): number {
    let p = pos
    while (p > 0 && /\s/.test(this.buf[p - 1] as string)) p--
    while (p > 0 && !/\s/.test(this.buf[p - 1] as string)) p--
    return p
  }
  private wordEnd(pos: number): number {
    let p = pos
    while (p < this.buf.length && /\s/.test(this.buf[p] as string)) p++
    while (p < this.buf.length && !/\s/.test(this.buf[p] as string)) p++
    return p
  }

  private insert(s: string): void {
    this.buf = this.buf.slice(0, this.cur) + s + this.buf.slice(this.cur)
    this.cur += s.length
    this.render()
  }

  private backspace(): void {
    if (this.cur === 0) return
    const n = this.stepBack(this.cur)
    this.buf = this.buf.slice(0, this.cur - n) + this.buf.slice(this.cur)
    this.cur -= n
    this.render()
  }

  private deleteForward(): void {
    const n = this.stepFwd(this.cur)
    if (n === 0) return
    this.buf = this.buf.slice(0, this.cur) + this.buf.slice(this.cur + n)
    this.render()
  }

  private killWord(): void {
    const start = this.wordStart(this.cur)
    this.buf = this.buf.slice(0, start) + this.buf.slice(this.cur)
    this.cur = start
    this.render()
  }

  private moveTo(pos: number): void {
    this.cur = Math.max(0, Math.min(this.buf.length, pos))
    this.render()
  }

  private history(dir: -1 | 1): void {
    const h = this.shell.history
    if (dir === -1 && this.histIdx > 0) {
      if (this.histIdx === h.length) this.draft = this.buf
      this.histIdx--
      this.buf = h[this.histIdx] as string
    } else if (dir === 1 && this.histIdx < h.length) {
      this.histIdx++
      this.buf = this.histIdx === h.length ? this.draft : (h[this.histIdx] as string)
    } else return
    this.cur = this.buf.length
    this.render()
  }

  private tab(): void {
    const { start, candidates } = this.shell.complete(this.buf, this.cur)
    if (candidates.length === 0) return
    const typed = this.buf.slice(start, this.cur)

    if (candidates.length === 1) {
      const c = candidates[0] as string
      this.replace(start, c + (c.endsWith('/') ? '' : ' '))
      return
    }
    const common = commonPrefix(candidates)
    if (common.length > typed.length) {
      this.replace(start, common)
      return
    }
    if (!this.lastTabAmbiguous) {
      this.lastTabAmbiguous = true
      return
    }
    // second Tab in a row: list the options below the prompt, then redraw it
    this.moveCursorToEnd()
    this.term.write('\r\n' + columns(candidates, candidates, this.term.cols).replace(/\n/g, '\r\n'))
    this.cursorRow = 0
    this.render()
  }

  private replace(start: number, text: string): void {
    this.buf = this.buf.slice(0, start) + text + this.buf.slice(this.cur)
    this.cur = start + text.length
    this.render()
  }

  private interrupt(): void {
    this.moveCursorToEnd()
    this.term.write('^C\r\n')
    this.buf = ''
    this.cur = 0
    this.draft = ''
    this.histIdx = this.shell.history.length
    this.showPrompt()
  }

  private submit(): void {
    this.moveCursorToEnd(true)
    const line = this.buf
    this.buf = ''
    this.cur = 0
    this.draft = ''

    const result = this.shell.execute(line, this.term.cols)
    if (result.clear) this.opts.onClear?.()
    if (result.output) {
      let text = result.output.replace(/\n/g, '\r\n')
      if (!text.endsWith('\r\n')) text += '\r\n'
      this.term.write(text)
    }
    this.opts.onHistory?.(this.shell.history)
    this.histIdx = this.shell.history.length
    this.showPrompt()
  }

  // ------------------------------------------------------------ rendering

  private showPrompt(): void {
    this.prompt = this.shell.prompt()
    this.cursorRow = 0
    this.render()
  }

  /** Put the terminal cursor after the last input character, ready for output below. */
  private moveCursorToEnd(newline = false): void {
    const cols = Math.max(1, this.term.cols)
    const endPos = this.prompt.length + this.buf.length
    const endRow = Math.floor(endPos / cols)
    const endCol = endPos % cols
    const wrapped = endPos > 0 && endCol === 0 // render() already forced the wrap
    let out = ''
    if (endRow > this.cursorRow) out += `\x1b[${endRow - this.cursorRow}B`
    if (newline) out += wrapped ? '\r' : '\r\n'
    else out += '\r' + (endCol > 0 ? `\x1b[${endCol}C` : '')
    this.term.write(out)
    this.cursorRow = endRow
  }

  private render(): void {
    const cols = Math.max(1, this.term.cols)
    const pl = this.prompt.length
    const endPos = pl + this.buf.length
    const endRow = Math.floor(endPos / cols)
    const curPos = pl + this.cur
    const curRow = Math.floor(curPos / cols)
    const curCol = curPos % cols

    let out = ''
    if (this.cursorRow > 0) out += `\x1b[${this.cursorRow}A`
    out += '\r\x1b[J' + this.prompt.text + this.buf
    if (endPos > 0 && endPos % cols === 0) out += ' \r' // force the pending wrap so rows line up
    if (endRow > curRow) out += `\x1b[${endRow - curRow}A`
    out += '\r'
    if (curCol > 0) out += `\x1b[${curCol}C`
    this.cursorRow = curRow
    this.term.write(out)
  }
}

function commonPrefix(xs: string[]): string {
  let p = xs[0] as string
  for (const x of xs) while (!x.startsWith(p)) p = p.slice(0, -1)
  return p
}
