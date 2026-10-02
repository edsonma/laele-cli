// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import indexHtml from '../index.html?raw'

type Started = Awaited<ReturnType<typeof import('./main').start>>
let app: Started

// jsdom has no layout engine, so stub the few browser APIs main.ts relies on.
beforeAll(async () => {
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/.exec(indexHtml)![1]!.replace(/<script[\s\S]*?<\/script>/g, '')

  const mql = (q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  })
  vi.stubGlobal('matchMedia', mql)
  window.matchMedia = mql as never
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  Object.defineProperty(document, 'fonts', { value: { load: () => Promise.resolve([]) }, configurable: true })
  HTMLCanvasElement.prototype.getContext = (() => null) as never

  const { start } = await import('./main')
  app = await start()
})

/** What the real xterm.js shows: one string per buffer row (trailing blanks trimmed). */
function screen(): string[] {
  const buf = app.term.buffer.active
  const rows: string[] = []
  for (let i = 0; i < buf.length; i++) rows.push(buf.getLine(i)?.translateToString(true) ?? '')
  while (rows.length && rows[rows.length - 1] === '') rows.pop()
  return rows
}
const cursor = () => {
  const b = app.term.buffer.active
  return { row: b.baseY + b.cursorY, col: b.cursorX }
}
/** Send keystrokes, then wait until xterm has finished processing everything written so far. */
const type = async (s: string) => {
  app.term.input(s, true)
  await new Promise<void>((r) => app.term.write('', r))
}

const PROMPT = 'visitante@salvador:~$ '

describe('page wiring', () => {
  it('boots xterm inside #terminal and prints the banner and prompt', async () => {
    expect(document.querySelector('#terminal .xterm')).not.toBeNull()
    await new Promise<void>((r) => app.term.write('', r))
    const rows = screen()
    expect(rows[0]).toContain('laele')
    expect(rows[1]).toContain('Tente ls, giria ou help')
    expect(rows.at(-1)).toBe(PROMPT)
  })

  it('has the controls and suggestions the script expects', async () => {
    expect(document.querySelectorAll('input[name="mode"]')).toHaveLength(4)
    expect(document.querySelector('#meaning')).not.toBeNull()
    expect(document.querySelectorAll('.chips button').length).toBeGreaterThanOrEqual(3)
  })

  it('every suggestion chip is a command the shell actually understands', async () => {
    const { Shell } = await import('./shell')
    const sh = new Shell(() => 0)
    for (const b of document.querySelectorAll<HTMLButtonElement>('.chips button')) {
      const out = sh.execute(b.dataset.cmd!).output
      expect(out, b.dataset.cmd).not.toContain('comando não encontrado')
      expect(out, b.dataset.cmd).not.toMatch(/erro de sintaxe/)
      expect(out.length, b.dataset.cmd).toBeGreaterThan(0)
    }
  })
})

describe('end to end through the real xterm.js', () => {
  it('typing a command runs it: slang line, output, new prompt', async () => {
    await type('echo oi\r')
    const rows = screen()
    const i = rows.lastIndexOf(PROMPT + 'echo oi')
    expect(i).toBeGreaterThan(-1)
    expect(rows[i + 1]).toContain('🌴')
    expect(rows[i + 2]).toBe('oi')
    expect(rows[i + 3]).toBe(PROMPT)
  })

  it('the mode radios drive the shell, and laele -mode updates the radios', async () => {
    const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="mode"]')]
    const pick = (v: string) => {
      const r = radios.find((x) => x.value === v)!
      r.checked = true
      r.dispatchEvent(new Event('change'))
    }
    pick('after')
    expect(app.shell.settings.mode).toBe('after')
    await type('echo a; echo b\r')
    const rows = screen()
    const a = rows.lastIndexOf('a')
    expect(rows[a + 1]).toBe('b')
    expect(rows[a + 2]).toContain('🌴')

    await type('laele -mode middle\r')
    expect(app.shell.settings.mode).toBe('middle')
    expect(radios.find((r) => r.checked)!.value).toBe('middle')
  })

  it('the meaning checkbox adds the explanation line', async () => {
    const box = document.querySelector<HTMLInputElement>('#meaning')!
    box.checked = true
    box.dispatchEvent(new Event('change'))
    await type('echo x\r')
    expect(screen().some((l) => l.includes('↳'))).toBe(true)
    box.checked = false
    box.dispatchEvent(new Event('change'))
  })

  it('clear wipes the screen', async () => {
    await type('clear\r')
    expect(screen()).toEqual([PROMPT])
  })
})

describe('wrapped input, checked against the real xterm.js (not my emulator)', () => {
  const full = (rows: string[]) => rows.join('')
  const promptLen = PROMPT.length

  it('long lines wrap and the cursor lands where it should', async () => {
    await type('clear\r')
    app.term.resize(30, 24)
    const text = 'echo ' + 'x'.repeat(40)
    await type(text)
    expect(full(screen())).toBe(PROMPT + text)
    const n = promptLen + text.length
    expect(cursor()).toEqual({ row: Math.floor(n / 30), col: n % 30 })
  })

  it('line that ends exactly on the last column, then backspace across the boundary', async () => {
    await type('\x05\x15') // clear the line
    const text = 'y'.repeat(30 - promptLen)
    await type(text)
    expect(cursor()).toEqual({ row: 1, col: 0 })
    await type('z')
    expect(full(screen())).toBe(PROMPT + text + 'z')
    expect(cursor()).toEqual({ row: 1, col: 1 })
    await type('\x7f\x7f')
    expect(full(screen())).toBe(PROMPT + text.slice(0, -1))
    expect(cursor()).toEqual({ row: 0, col: 29 })
  })

  it('editing in the middle of a wrapped line', async () => {
    await type('\x05\x15')
    await type('a'.repeat(50))
    await type('\x1b[D'.repeat(35))
    await type('Z')
    const expected = 'a'.repeat(15) + 'Z' + 'a'.repeat(35)
    expect(full(screen())).toBe(PROMPT + expected)
    const pos = promptLen + 16
    expect(cursor()).toEqual({ row: Math.floor(pos / 30), col: pos % 30 })
  })

  it('running a wrapped command leaves no gap before its output', async () => {
    await type('\x05\x15')
    const cmd = 'laele' + ' '.repeat(30) + '-mode before'
    await type(cmd + '\r')
    const rows = screen()
    expect(rows.at(-1)).toBe(PROMPT)
    expect(rows.at(-2)).toBe('modo: antes (before)')
    expect(full(rows.slice(-5, -2))).toBe(PROMPT + cmd) // typed command, 3 rows, no gap before the output
  })
})
