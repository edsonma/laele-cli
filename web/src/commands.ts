import { VFS, fsErrorText, type FsError } from './vfs'
import { entries, parseMode, search, type Mode } from './slang'

export interface Settings {
  mode: Mode
  meaning: boolean
}

/** The slice of shell state that builtins are allowed to touch. */
export interface ShellState {
  cwd: string
  prevCwd: string
  history: string[]
  settings: Settings
  setSettings(patch: Partial<Settings>): void
  status: number
  rng: () => number
}

export interface Ctx {
  args: string[]
  stdin: string | undefined
  vfs: VFS
  env: Map<string, string>
  cols: number
  /** True when stdout is the terminal itself (not a pipe or a redirect). */
  color: boolean
  shell: ShellState
}

export interface Result {
  out?: string
  err?: string
  code?: number
  /** Skip slang injection for this command (meta commands, clear, ...). */
  noSlang?: boolean
  clear?: boolean
}

export type Command = (ctx: Ctx) => Result

const BLUE = '\x1b[1;34m'
const BOLD_ORANGE = '\x1b[1;38;2;255;138;42m'
const RED = '\x1b[1;31m'
const RESET = '\x1b[0m'

const resolve = (ctx: Ctx, p: string) => ctx.vfs.normalize(p, ctx.shell.cwd)
const failure = (cmd: string, path: string, e: FsError) => `${cmd}: ${path}: ${fsErrorText[e]}\n`
const basename = (abs: string) => abs.slice(abs.lastIndexOf('/') + 1)

/** Split argv into single-letter flags and operands. Understands `--` and `-abc`. */
function flagsOf(args: string[]): { flags: Set<string>; rest: string[]; unknown?: string } {
  const flags = new Set<string>()
  const rest: string[] = []
  let done = false
  for (const a of args) {
    if (!done && a === '--') done = true
    else if (!done && /^-[A-Za-z]+$/.test(a)) for (const c of a.slice(1)) flags.add(c)
    else rest.push(a)
  }
  return { flags, rest }
}

function checkFlags(cmd: string, flags: Set<string>, allowed: string): string | null {
  for (const f of flags) if (!allowed.includes(f)) return `${cmd}: opção inválida -- '${f}'\n`
  return null
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function columns(plain: string[], shown: string[], width: number): string {
  if (plain.length === 0) return ''
  const len = (s: string) => [...s].length
  for (let n = Math.min(plain.length, Math.max(1, Math.floor(width / 3))); n >= 1; n--) {
    const rows = Math.ceil(plain.length / n)
    const colW: number[] = []
    for (let c = 0; c < n; c++) {
      let w = 0
      for (let r = 0; r < rows; r++) w = Math.max(w, len(plain[c * rows + r] ?? ''))
      colW.push(w)
    }
    const total = colW.reduce((a, b) => a + b, 0) + 2 * (n - 1)
    if (total > width && n > 1) continue
    let out = ''
    for (let r = 0; r < rows; r++) {
      const cells: string[] = []
      for (let c = 0; c < n; c++) {
        const i = c * rows + r
        if (i >= plain.length) continue
        const pad = ' '.repeat((colW[c] ?? 0) - len(plain[i] as string))
        cells.push(c === n - 1 || i + rows >= plain.length ? (shown[i] as string) : (shown[i] as string) + pad)
      }
      out += cells.join('  ') + '\n'
    }
    return out
  }
  return plain.join('\n') + '\n'
}

// ---------------------------------------------------------------- commands

const echo: Command = ({ args }) => {
  let newline = true
  let escapes = false
  let i = 0
  for (; i < args.length; i++) {
    const a = args[i] as string
    if (!/^-[neE]+$/.test(a)) break
    if (a.includes('n')) newline = false
    if (a.includes('e')) escapes = true
    if (a.includes('E')) escapes = false
  }
  let s = args.slice(i).join(' ')
  if (escapes) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\')
  return { out: s + (newline ? '\n' : '') }
}

const pwd: Command = ({ shell }) => ({ out: shell.cwd + '\n' })

const cd: Command = (ctx) => {
  const { shell, env } = ctx
  const home = env.get('HOME') ?? '/'
  let target = ctx.args[0] ?? '~'
  if (target === '-') target = shell.prevCwd
  if (target === '~') target = home
  else if (target.startsWith('~/')) target = home + target.slice(1)
  const abs = resolve(ctx, target)
  const node = ctx.vfs.get(abs)
  if (!node) return { err: failure('bash: cd', ctx.args[0] ?? target, 'ENOENT'), code: 1 }
  if (node.type !== 'dir') return { err: failure('bash: cd', ctx.args[0] ?? target, 'ENOTDIR'), code: 1 }
  const printed = ctx.args[0] === '-' ? abs + '\n' : ''
  shell.prevCwd = shell.cwd
  shell.cwd = abs
  env.set('OLDPWD', shell.prevCwd)
  env.set('PWD', abs)
  return { out: printed }
}

const ls: Command = (ctx) => {
  const { flags, rest } = flagsOf(ctx.args)
  const bad = checkFlags('ls', flags, 'al1')
  if (bad) return { err: bad, code: 2 }
  const showAll = flags.has('a')
  const long = flags.has('l')
  const oneCol = flags.has('1') || !ctx.color
  let err = ''
  let code = 0

  type Row = { name: string; node: NonNullable<ReturnType<VFS['get']>> }
  const render = (rows: Row[]): string => {
    if (long) return longListing(rows, ctx.color)
    const plain = rows.map((r) => r.name)
    const shown = rows.map((r) => (ctx.color && r.node.type === 'dir' ? `${BLUE}${r.name}${RESET}` : r.name))
    return oneCol ? shown.join('\n') + (shown.length ? '\n' : '') : columns(plain, shown, ctx.cols)
  }

  const files: Row[] = []
  const dirs: { label: string; rows: Row[] }[] = []
  for (const t of rest.length ? rest : ['.']) {
    const abs = resolve(ctx, t)
    const node = ctx.vfs.get(abs)
    if (!node) {
      err += `ls: não foi possível acessar '${t}': ${fsErrorText.ENOENT}\n`
      code = 2
    } else if (node.type === 'file') {
      files.push({ name: t, node })
    } else {
      const names = ctx.vfs.readdir(abs) as string[]
      const rows: Row[] = []
      if (showAll) {
        rows.push({ name: '.', node }, { name: '..', node: ctx.vfs.get(resolve(ctx, abs + '/..')) ?? node })
      }
      for (const name of names) {
        if (!showAll && name.startsWith('.')) continue
        rows.push({ name, node: ctx.vfs.get(abs + (abs === '/' ? '' : '/') + name) as Row['node'] })
      }
      dirs.push({ label: t, rows })
    }
  }

  const blocks: string[] = []
  if (files.length) blocks.push(render(files))
  for (const d of dirs) {
    const head = rest.length > 1 ? `${d.label}:\n` : ''
    blocks.push(head + render(d.rows))
  }
  return { out: blocks.join('\n'), err, code }
}

function longListing(rows: { name: string; node: { type: string; mtime: Date; content?: string } }[], color: boolean): string {
  const size = (n: { type: string; content?: string }) => (n.type === 'dir' ? 4096 : new TextEncoder().encode(n.content ?? '').length)
  const w = Math.max(1, ...rows.map((r) => String(size(r.node)).length))
  const blocks = rows.reduce((a, r) => a + Math.max(4, Math.ceil(size(r.node) / 1024)), 0)
  let out = `total ${blocks}\n`
  for (const r of rows) {
    const d = r.node.mtime
    const date = `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const isDir = r.node.type === 'dir'
    const perms = isDir ? 'drwxr-xr-x' : '-rw-r--r--'
    const name = color && isDir ? `${BLUE}${r.name}${RESET}` : r.name
    out += `${perms} 1 visitante visitante ${String(size(r.node)).padStart(w)} ${date} ${name}\n`
  }
  return out
}

const cat: Command = (ctx) => {
  const { flags, rest } = flagsOf(ctx.args)
  const bad = checkFlags('cat', flags, 'n')
  if (bad) return { err: bad, code: 1 }
  let out = ''
  let err = ''
  let code = 0
  const sources = rest.length ? rest : ['-']
  for (const s of sources) {
    if (s === '-') {
      out += ctx.stdin ?? ''
      continue
    }
    const r = ctx.vfs.readFile(resolve(ctx, s))
    if (r.ok) out += r.content
    else {
      err += failure('cat', s, r.error)
      code = 1
    }
  }
  if (flags.has('n') && out) {
    let n = 0
    out = out
      .split('\n')
      .map((l, i, a) => (i === a.length - 1 && l === '' ? l : `${String(++n).padStart(6)}\t${l}`))
      .join('\n')
  }
  return { out, err, code }
}

const mkdir: Command = (ctx) => {
  const { flags, rest } = flagsOf(ctx.args)
  const bad = checkFlags('mkdir', flags, 'p')
  if (bad) return { err: bad, code: 1 }
  if (!rest.length) return { err: 'mkdir: faltou operando\n', code: 1 }
  let err = ''
  for (const p of rest) {
    const e = ctx.vfs.mkdir(resolve(ctx, p), flags.has('p'))
    if (e) err += `mkdir: não foi possível criar o diretório '${p}': ${fsErrorText[e]}\n`
  }
  return { err, code: err ? 1 : 0 }
}

const touch: Command = (ctx) => {
  if (!ctx.args.length) return { err: 'touch: faltou operando\n', code: 1 }
  let err = ''
  for (const p of ctx.args) {
    const abs = resolve(ctx, p)
    const existing = ctx.vfs.readFile(abs)
    const e = ctx.vfs.writeFile(abs, existing.ok ? existing.content : '', false)
    if (e) err += `touch: não foi possível fazer touch em '${p}': ${fsErrorText[e]}\n`
  }
  return { err, code: err ? 1 : 0 }
}

const rm: Command = (ctx) => {
  const { flags, rest } = flagsOf(ctx.args)
  const bad = checkFlags('rm', flags, 'rRf')
  if (bad) return { err: bad, code: 1 }
  if (!rest.length) return { err: flags.has('f') ? '' : 'rm: faltou operando\n', code: flags.has('f') ? 0 : 1 }
  const recursive = flags.has('r') || flags.has('R')
  let err = ''
  for (const p of rest) {
    const abs = resolve(ctx, p)
    const home = ctx.env.get('HOME') ?? '/'
    if (recursive && (abs === '/' || home === abs || home.startsWith(abs + '/'))) {
      return { err: 'rm: Lá ele! Apagar tudo? Deus me livre, viu!\n', code: 1 }
    }
    const e = ctx.vfs.remove(abs, recursive)
    if (e === 'ENOENT' && flags.has('f')) continue
    if (e) err += `rm: não foi possível remover '${p}': ${fsErrorText[e]}\n`
  }
  return { err, code: err ? 1 : 0 }
}

function destFor(ctx: Ctx, src: string, dest: string): string {
  const abs = resolve(ctx, dest)
  return ctx.vfs.isDir(abs) ? (abs === '/' ? '' : abs) + '/' + basename(resolve(ctx, src)) : abs
}

const copyOrMove = (name: 'cp' | 'mv'): Command => (ctx) => {
  const { flags, rest } = flagsOf(ctx.args)
  const bad = checkFlags(name, flags, 'rRf')
  if (bad) return { err: bad, code: 1 }
  if (rest.length < 2) return { err: `${name}: faltou operando${rest.length ? ' de destino' : ''}\n`, code: 1 }
  const dest = rest[rest.length - 1] as string
  const sources = rest.slice(0, -1)
  const destAbs = resolve(ctx, dest)
  if (sources.length > 1 && !ctx.vfs.isDir(destAbs)) {
    return { err: `${name}: o alvo '${dest}' não é um diretório\n`, code: 1 }
  }
  let err = ''
  for (const s of sources) {
    const srcAbs = resolve(ctx, s)
    const node = ctx.vfs.get(srcAbs)
    if (!node) {
      err += `${name}: não foi possível obter estado de '${s}': ${fsErrorText.ENOENT}\n`
      continue
    }
    if (name === 'cp' && node.type === 'dir' && !flags.has('r') && !flags.has('R')) {
      err += `cp: -r não especificado; omitindo o diretório '${s}'\n`
      continue
    }
    const target = destFor(ctx, s, dest)
    const e = name === 'cp' ? ctx.vfs.copy(srcAbs, target) : ctx.vfs.move(srcAbs, target)
    if (e) err += `${name}: não foi possível ${name === 'cp' ? 'copiar' : 'mover'} '${s}' para '${dest}': ${fsErrorText[e]}\n`
  }
  return { err, code: err ? 1 : 0 }
}

/** Shared input reading for head/tail/wc/sort/grep: files, or stdin when none given. */
function readInputs(ctx: Ctx, cmd: string, files: string[]): { texts: { name: string; text: string }[]; err: string } {
  if (!files.length) return { texts: [{ name: '(entrada padrão)', text: ctx.stdin ?? '' }], err: '' }
  const texts: { name: string; text: string }[] = []
  let err = ''
  for (const f of files) {
    if (f === '-') {
      texts.push({ name: '-', text: ctx.stdin ?? '' })
      continue
    }
    const r = ctx.vfs.readFile(resolve(ctx, f))
    if (r.ok) texts.push({ name: f, text: r.content })
    else err += failure(cmd, f, r.error)
  }
  return { texts, err }
}

const splitLines = (t: string) => {
  const l = t.split('\n')
  if (l[l.length - 1] === '') l.pop()
  return l
}

function parseCount(cmd: string, args: string[]): { n: number; files: string[]; err?: string } {
  let n = 10
  const files: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    let v: string | undefined
    if (a === '-n') v = args[++i]
    else if (a.startsWith('-n')) v = a.slice(2)
    else if (/^-\d+$/.test(a)) v = a.slice(1)
    else {
      files.push(a)
      continue
    }
    if (v === undefined || !/^\d+$/.test(v)) return { n, files, err: `${cmd}: número de linhas inválido: '${v ?? ''}'\n` }
    n = Number(v)
  }
  return { n, files }
}

const headTail = (name: 'head' | 'tail'): Command => (ctx) => {
  const { n, files, err: perr } = parseCount(name, ctx.args)
  if (perr) return { err: perr, code: 1 }
  const { texts, err } = readInputs(ctx, name, files)
  let out = ''
  texts.forEach((t, i) => {
    if (texts.length > 1) out += `${i ? '\n' : ''}==> ${t.name} <==\n`
    const lines = splitLines(t.text)
    const part = name === 'head' ? lines.slice(0, n) : n === 0 ? [] : lines.slice(-n)
    out += part.map((l) => l + '\n').join('')
  })
  return { out, err, code: err ? 1 : 0 }
}

const wc: Command = (ctx) => {
  const { flags, rest } = flagsOf(ctx.args)
  const bad = checkFlags('wc', flags, 'lwc')
  if (bad) return { err: bad, code: 1 }
  const all = !flags.size
  const { texts, err } = readInputs(ctx, 'wc', rest)
  const rows = texts.map((t) => ({
    name: rest.length ? t.name : '',
    l: (t.text.match(/\n/g) ?? []).length,
    w: t.text.split(/\s+/).filter(Boolean).length,
    c: new TextEncoder().encode(t.text).length,
  }))
  if (rows.length > 1) {
    rows.push({ name: 'total', l: sum(rows, 'l'), w: sum(rows, 'w'), c: sum(rows, 'c') })
  }
  const out = rows
    .map((r) => {
      const cols = [all || flags.has('l') ? r.l : null, all || flags.has('w') ? r.w : null, all || flags.has('c') ? r.c : null]
      return cols.filter((x) => x !== null).map((x) => String(x).padStart(7)).join('') + (r.name ? ' ' + r.name : '') + '\n'
    })
    .join('')
  return { out, err, code: err ? 1 : 0 }
}
const sum = (rows: { l: number; w: number; c: number }[], k: 'l' | 'w' | 'c') => rows.reduce((a, r) => a + r[k], 0)

const grep: Command = (ctx) => {
  const { flags, rest } = flagsOf(ctx.args)
  const bad = checkFlags('grep', flags, 'invcE')
  if (bad) return { err: bad, code: 2 }
  const pattern = rest[0]
  if (pattern === undefined) return { err: 'Uso: grep [OPÇÃO]... PADRÕES [ARQUIVO]...\n', code: 2 }
  let re: RegExp
  const reFlags = flags.has('i') ? 'i' : ''
  try {
    re = new RegExp(pattern, reFlags + 'g')
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), reFlags + 'g')
  }
  const { texts, err } = readInputs(ctx, 'grep', rest.slice(1))
  const prefix = rest.length > 2
  let out = ''
  let matches = 0
  for (const t of texts) {
    let count = 0
    splitLines(t.text).forEach((line, idx) => {
      re.lastIndex = 0
      const hit = re.test(line)
      if (hit === flags.has('v')) return
      count++
      if (flags.has('c')) return
      let shown = line
      if (ctx.color && !flags.has('v')) shown = line.replace(re, (m) => `${RED}${m}${RESET}`)
      out += (prefix ? `${t.name}:` : '') + (flags.has('n') ? `${idx + 1}:` : '') + shown + '\n'
    })
    if (flags.has('c')) out += (prefix ? `${t.name}:` : '') + count + '\n'
    matches += count
  }
  return { out, err, code: matches > 0 ? (err ? 2 : 0) : err ? 2 : 1 }
}

const sort: Command = (ctx) => {
  const { flags, rest } = flagsOf(ctx.args)
  const bad = checkFlags('sort', flags, 'rnu')
  if (bad) return { err: bad, code: 2 }
  const { texts, err } = readInputs(ctx, 'sort', rest)
  let lines = texts.flatMap((t) => splitLines(t.text))
  lines.sort(flags.has('n') ? (a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b, 'pt-BR') : (a, b) => a.localeCompare(b, 'pt-BR'))
  if (flags.has('u')) lines = lines.filter((l, i) => i === 0 || l !== lines[i - 1])
  if (flags.has('r')) lines.reverse()
  return { out: lines.map((l) => l + '\n').join(''), err, code: err ? 2 : 0 }
}

const history: Command = ({ shell }) => ({
  out: shell.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}\n`).join(''),
  noSlang: true,
})

const date: Command = () => ({
  out:
    new Date().toLocaleString('pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + '\n',
})

const uname: Command = ({ args }) => {
  const full = 'Linux salvador 6.1.0-laele #1 SMP x86_64 GNU/Linux'
  if (args.includes('-a')) return { out: full + '\n' }
  if (args.includes('-r')) return { out: '6.1.0-laele\n' }
  if (args.includes('-n')) return { out: 'salvador\n' }
  return { out: 'Linux\n' }
}

const env: Command = ({ env }) => ({
  out: [...env.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}\n`)
    .join(''),
})

const exportCmd: Command = ({ args, env }) => {
  if (!args.length) return env_out(env)
  for (const a of args) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/s.exec(a)
    if (!m) return { err: `bash: export: \`${a}': não é um identificador válido\n`, code: 1 }
    if (m[2] !== undefined) env.set(m[1] as string, m[2])
    else if (!env.has(m[1] as string)) env.set(m[1] as string, '')
  }
  return {}
}
const env_out = (e: Map<string, string>): Result => ({
  out: [...e.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `declare -x ${k}="${v}"\n`).join(''),
})

const unset: Command = ({ args, env }) => {
  for (const a of args) env.delete(a)
  return {}
}

const blocked =
  (name: string, msg: string): Command =>
  () => ({ err: `bash: ${name}: ${msg}\n`, code: 1 })

const fullscreen = (name: string): Command => blocked(name, 'Lá ele! Programa de tela cheia não roda aqui, viu. Use cat pra ler arquivo.')

const exit: Command = () => ({
  out: 'Não dá pra sair não, viu! Isso aqui é um site. Pra se piquar, é só fechar a aba.\n',
})

const sudo: Command = () => ({ err: 'Lá ele! Aqui ninguém é root não, viu!\n', code: 1 })

const giria: Command = (ctx) => {
  const fmt = (e: (typeof entries)[number], withExample: boolean) => {
    const b = ctx.color ? BOLD_ORANGE : ''
    const r = ctx.color ? RESET : ''
    let s = `${b}${e.term}${r}\n  ${e.meaning}\n`
    if (withExample && e.phrases.length) s += `  Ex.: ${e.phrases[Math.floor(ctx.shell.rng() * e.phrases.length)]}\n`
    return s
  }
  const args = ctx.args
  if (args.length === 0) {
    return { out: entries.map((e) => fmt(e, false)).join(''), noSlang: true }
  }
  if (args[0] === '-r' || args[0] === '--random') {
    const e = entries[Math.floor(ctx.shell.rng() * entries.length)] as (typeof entries)[number]
    return { out: fmt(e, true), noSlang: true }
  }
  const found = search(args.join(' '))
  if (!found.length) {
    return {
      err: `giria: nenhuma gíria encontrada para '${args.join(' ')}'. Rode 'giria' pra ver a lista inteira, viu!\n`,
      code: 1,
      noSlang: true,
    }
  }
  return { out: found.map((e) => fmt(e, true)).join('\n'), noSlang: true }
}

const MODE_LABEL: Record<Mode, string> = {
  before: 'antes (before)',
  middle: 'no meio (middle)',
  after: 'depois (after)',
  random: 'aleatório (random)',
}

const laeleHelp = `laele: bash com gíria de Salvador, viu!

Uso: laele [opções]
  -mode <m>     onde entra a gíria: before, middle, after ou random
  -meaning      mostra também o significado da gíria
  -nomeaning    esconde o significado
  -list         lista todas as gírias (igual ao comando giria)
  -version      mostra a versão
  -h, -help     mostra esta ajuda
`

const laele: Command = (ctx) => {
  const a = ctx.args
  if (!a.length) {
    const s = ctx.shell.settings
    return {
      out: `modo: ${MODE_LABEL[s.mode]}\nsignificado: ${s.meaning ? 'ligado' : 'desligado'}\n`,
      noSlang: true,
    }
  }
  let out = ''
  const patch: Partial<Settings> = {}
  for (let i = 0; i < a.length; i++) {
    const arg = a[i] as string
    const [flag, inline] = arg.replace(/^--?/, '').split(/=(.*)/s) as [string, string | undefined]
    switch (flag) {
      case 'mode': {
        const v = inline ?? a[++i]
        const m = v === undefined ? undefined : parseMode(v)
        if (!m) return { err: `laele: modo inválido '${v ?? ''}' (use before, middle, after ou random)\n`, code: 2, noSlang: true }
        patch.mode = m
        out += `modo: ${MODE_LABEL[m]}\n`
        break
      }
      case 'meaning':
        patch.meaning = true
        out += 'significado: ligado\n'
        break
      case 'nomeaning':
        patch.meaning = false
        out += 'significado: desligado\n'
        break
      case 'list':
        return giria({ ...ctx, args: [] })
      case 'version':
        return { out: 'laele web 0.1.0\n', noSlang: true }
      case 'h':
      case 'help':
        return { out: laeleHelp, noSlang: true }
      default:
        return { err: `laele: opção desconhecida '${arg}'. Veja laele -h\n`, code: 2, noSlang: true }
    }
  }
  ctx.shell.setSettings(patch)
  return { out, noSlang: true }
}

const clear: Command = () => ({ clear: true, noSlang: true })
const trueCmd: Command = () => ({})
const falseCmd: Command = () => ({ code: 1 })
const whoami: Command = () => ({ out: 'visitante\n' })
const hostname: Command = () => ({ out: 'salvador\n' })
const sleep: Command = () => ({})

const helpText = `Comandos disponíveis:

  arquivos   ls  cd  pwd  cat  mkdir  touch  rm  cp  mv
  texto      echo  head  tail  wc  grep  sort
  sistema    date  whoami  hostname  uname  env  export  unset  history  clear
  gíria      giria [termo]   giria -r   laele -h

Dá pra usar pipes (|), && , || , ; , > e >>, aspas, $VARIÁVEIS e * como no bash.
Aperte Tab pra completar e ↑ ↓ pro histórico.

Tente:  cat giria.txt | grep -i baba
`

const help: Command = () => ({ out: helpText })

export const commands: Record<string, Command> = {
  echo, pwd, cd, ls, cat, mkdir, touch, rm,
  cp: copyOrMove('cp'),
  mv: copyOrMove('mv'),
  head: headTail('head'),
  tail: headTail('tail'),
  wc, grep, sort, history, date, uname, env, export: exportCmd, unset,
  exit, logout: exit, sudo, giria, laele, clear, true: trueCmd, false: falseCmd,
  whoami, hostname, sleep, help,
  vim: fullscreen('vim'), vi: fullscreen('vi'), nano: fullscreen('nano'), emacs: fullscreen('emacs'),
  less: fullscreen('less'), more: fullscreen('more'), top: fullscreen('top'), htop: fullscreen('htop'),
  man: fullscreen('man'),
}
