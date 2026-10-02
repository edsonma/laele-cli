import { commands, type Settings, type ShellState, type Result } from './commands'
import { expandWord, globToRegExp, parse, tokenize, SyntaxError_, type Cmd } from './parser'
import { entries, inject, makeLine } from './slang'
import { VFS } from './vfs'

export interface ExecResult {
  /** Text to print, with \n line endings and slang already injected. */
  output: string
  clear: boolean
  status: number
}

const HOME = '/home/visitante'
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

const C_GREEN = '\x1b[1;32m'
const C_BLUE = '\x1b[1;34m'
const C_OFF = '\x1b[0m'

export class Shell implements ShellState {
  vfs: VFS
  cwd = HOME
  prevCwd = HOME
  history: string[] = []
  status = 0
  settings: Settings = { mode: 'before', meaning: false }
  onSettings?: (s: Settings) => void
  env = new Map<string, string>([
    ['HOME', HOME],
    ['USER', 'visitante'],
    ['HOSTNAME', 'salvador'],
    ['SHELL', '/bin/bash'],
    ['LANG', 'pt_BR.UTF-8'],
    ['PATH', '/usr/local/bin:/usr/bin:/bin'],
    ['PWD', HOME],
    ['OLDPWD', HOME],
    ['TERM', 'xterm-256color'],
  ])

  constructor(
    public rng: () => number = Math.random,
    now: () => Date = () => new Date(),
  ) {
    this.vfs = new VFS(now)
    seedFilesystem(this.vfs)
  }

  setSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch }
    this.onSettings?.(this.settings)
  }

  /** Prompt text with colors, and its visible length (the terminal needs it for cursor math). */
  prompt(): { text: string; length: number } {
    const path = this.cwd === HOME ? '~' : this.cwd.startsWith(HOME + '/') ? '~' + this.cwd.slice(HOME.length) : this.cwd
    const plain = `visitante@salvador:${path}$ `
    return {
      text: `${C_GREEN}visitante@salvador${C_OFF}:${C_BLUE}${path}${C_OFF}$ `,
      length: [...plain].length,
    }
  }

  execute(line: string, cols = 80): ExecResult {
    const trimmed = line.trim()
    if (!trimmed) return { output: '', clear: false, status: this.status }
    if (!line.startsWith(' ') && this.history[this.history.length - 1] !== trimmed) this.history.push(trimmed)

    let display = ''
    let noSlang = false
    let clear = false

    try {
      const items = parse(tokenize(line))
      let connector: string | null = null
      for (const item of items) {
        const skip = (connector === '&&' && this.status !== 0) || (connector === '||' && this.status === 0)
        if (!skip) {
          const r = this.runPipeline(item.pipeline, cols)
          display += r.display
          this.status = r.status
          noSlang ||= r.noSlang
          clear ||= r.clear
        }
        connector = item.next
      }
    } catch (e) {
      if (!(e instanceof SyntaxError_)) throw e
      display = `bash: ${e.message}\n`
      this.status = 2
      noSlang = false
    }

    if (clear) display = ''
    const output = noSlang || clear ? display : inject(display, this.settings.mode, () => makeLine(this.settings.meaning, this.rng), this.rng)
    return { output, clear, status: this.status }
  }

  private expandArg(raw: string): string[] {
    const ex = expandWord(raw, { get: (n) => this.env.get(n) ?? '', status: this.status, home: this.env.get('HOME') ?? HOME })
    if (!ex.glob) return [ex.value]
    const slash = ex.pattern.lastIndexOf('/')
    const dirPat = slash >= 0 ? ex.pattern.slice(0, slash + 1) : ''
    const filePat = ex.pattern.slice(slash + 1)
    if (/[*?]/.test(dirPat.replace(/\\./g, ''))) return [ex.value] // only the last segment is globbed
    const dirLiteral = dirPat.replace(/\\(.)/g, '$1')
    const names = this.vfs.readdir(this.vfs.normalize(dirLiteral || '.', this.cwd))
    if (typeof names === 'string') return [ex.value]
    const re = globToRegExp(filePat)
    const showHidden = filePat.startsWith('.')
    const matches = names.filter((n) => (showHidden || !n.startsWith('.')) && re.test(n))
    return matches.length ? matches.map((n) => dirLiteral + n) : [ex.value]
  }

  private runPipeline(
    pipeline: Cmd[],
    cols: number,
  ): { display: string; status: number; noSlang: boolean; clear: boolean } {
    let stdin: string | undefined
    let display = ''
    let status = 0
    let noSlang = false
    let clear = false

    pipeline.forEach((cmd, k) => {
      const isLast = k === pipeline.length - 1
      const argv = cmd.words.flatMap((w) => this.expandArg(w))

      // redirect targets (the last one wins, earlier ones are still created/truncated like bash)
      const targets = cmd.redirs.map((r) => ({ op: r.op, path: this.expandArg(r.target)[0] ?? '' }))

      let res: Result
      if (argv.length > 0 && argv.every((a) => ASSIGN.test(a))) {
        for (const a of argv) {
          const i = a.indexOf('=')
          this.env.set(a.slice(0, i), a.slice(i + 1))
        }
        res = {}
      } else if (argv.length === 0) {
        res = {}
      } else {
        const [name, ...args] = argv as [string, ...string[]]
        const fn = Object.hasOwn(commands, name) ? commands[name] : undefined
        if (!fn) {
          res = { err: `bash: ${name}: comando não encontrado\n`, code: 127 }
        } else {
          res = fn({
            args,
            stdin,
            vfs: this.vfs,
            env: this.env,
            cols,
            color: isLast && targets.length === 0,
            shell: this,
          })
        }
      }

      display += res.err ?? ''
      status = res.code ?? 0
      noSlang ||= !!res.noSlang
      clear ||= !!res.clear
      const out = res.out ?? ''

      if (targets.length) {
        targets.forEach((t, i) => {
          const abs = this.vfs.normalize(t.path, this.cwd)
          const last = i === targets.length - 1
          const e = this.vfs.writeFile(abs, last ? out : '', last && t.op === '>>')
          if (e) {
            display += `bash: ${t.path}: ${e === 'EISDIR' ? 'É um diretório' : 'Arquivo ou diretório inexistente'}\n`
            status = 1
          }
        })
        stdin = ''
      } else if (isLast) {
        display += out
      } else {
        stdin = out
      }
    })

    return { display, status, noSlang, clear }
  }

  /** Tab completion: returns where the word starts and the full replacement candidates. */
  complete(line: string, cursor: number): { start: number; candidates: string[] } {
    let start = cursor
    while (start > 0 && !/[\s|;&<>]/.test(line[start - 1] as string)) start--
    const prefix = line.slice(start, cursor)
    const before = line.slice(0, start).trimEnd()
    const commandPosition = before === '' || /[|;&]$/.test(before)

    if (commandPosition && !prefix.includes('/')) {
      const names = Object.keys(commands).filter((n) => n.startsWith(prefix)).sort()
      return { start, candidates: names }
    }

    const slash = prefix.lastIndexOf('/')
    const dirPart = prefix.slice(0, slash + 1)
    const filePart = prefix.slice(slash + 1)
    const home = this.env.get('HOME') ?? HOME
    const dirForFs = dirPart === '~/' ? home + '/' : dirPart.startsWith('~/') ? home + dirPart.slice(1) : dirPart
    const abs = this.vfs.normalize(dirForFs || '.', this.cwd)
    const names = this.vfs.readdir(abs)
    if (typeof names === 'string') return { start, candidates: [] }
    const candidates = names
      .filter((n) => n.startsWith(filePart) && (filePart.startsWith('.') || !n.startsWith('.')))
      .map((n) => dirPart + n + (this.vfs.isDir(abs === '/' ? '/' + n : `${abs}/${n}`) ? '/' : ''))
    return { start, candidates }
  }
}

function seedFilesystem(vfs: VFS): void {
  const w = (path: string, content: string) => {
    const err = vfs.writeFile(path, content)
    if (err) throw new Error(`seed ${path}: ${err}`)
  }
  for (const d of [HOME + '/Pelourinho', HOME + '/Capoeira', '/tmp', '/etc']) vfs.mkdir(d, true)

  w(
    HOME + '/README.md',
    `laele 🌴
Um terminal que fala baianês. A cada comando, uma gíria de Salvador, viu!

Experimente:
  ls
  cat giria.txt | grep -i baba
  giria barril
  laele -mode random
  laele -meaning

Digite help pra ver os comandos.
`,
  )
  w(HOME + '/giria.txt', entries.map((e) => `${e.term}: ${e.meaning}\n`).join(''))
  w(HOME + '/.bashrc', '# aqui não tem nada de útil, viu!\n')
  w(
    HOME + '/Pelourinho/acaraje.txt',
    'Acarajé: bolinho de feijão-fradinho frito no azeite de dendê, recheado com vatapá, caruru e camarão.\n',
  )
  w(
    HOME + '/Pelourinho/elevador-lacerda.txt',
    'O Elevador Lacerda liga a Cidade Baixa à Cidade Alta. Sobe rapidinho, viu!\n',
  )
  w(
    HOME + '/Pelourinho/farol-da-barra.txt',
    'O Farol da Barra é um dos cartões-postais de Salvador. O pôr do sol dali é barril, viu!\n',
  )
  w(
    HOME + '/Capoeira/roda.txt',
    'Na roda de capoeira o berimbau dá o ritmo, dois jogam no meio e todo mundo canta e bate palma, viu!\n',
  )
  w('/etc/hostname', 'salvador\n')
}
