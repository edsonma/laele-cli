// Tokenizer, parser and word expansion for the fake shell.
// Supported: quotes, backslash escapes, $VAR / ${VAR} / $?, ~, * and ? globs,
// pipes (|), lists (; && ||) and output redirection (> >>).

export type Op = '|' | '||' | '&&' | ';' | '>' | '>>' | '<'

export type Token = { t: 'word'; raw: string } | { t: 'op'; op: Op }

export class SyntaxError_ extends Error {}

const OP_CHARS = new Set(['|', '&', ';', '>', '<'])

export function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < line.length) {
    const c = line[i] as string
    if (c === ' ' || c === '\t') {
      i++
      continue
    }
    if (c === '#') break // comment

    if (OP_CHARS.has(c)) {
      const two = line.slice(i, i + 2)
      if (two === '&&' || two === '||' || two === '>>') {
        tokens.push({ t: 'op', op: two })
        i += 2
      } else if (c === '&') {
        tokens.push({ t: 'op', op: ';' }) // no background jobs: treat & as a separator
        i++
      } else {
        tokens.push({ t: 'op', op: c as Op })
        i++
      }
      continue
    }

    let raw = ''
    while (i < line.length) {
      const ch = line[i] as string
      if (ch === ' ' || ch === '\t' || OP_CHARS.has(ch)) break
      if (ch === '\\') {
        raw += line.slice(i, i + 2)
        i += 2
      } else if (ch === "'" || ch === '"') {
        const end = findClosingQuote(line, i)
        if (end < 0) throw new SyntaxError_('aspas não fechadas')
        raw += line.slice(i, end + 1)
        i = end + 1
      } else {
        raw += ch
        i++
      }
    }
    tokens.push({ t: 'word', raw })
  }
  return tokens
}

function findClosingQuote(s: string, start: number): number {
  const q = s[start]
  for (let i = start + 1; i < s.length; i++) {
    if (q === '"' && s[i] === '\\') i++
    else if (s[i] === q) return i
  }
  return -1
}

// --- parsing ---

export interface Redirect {
  op: '>' | '>>'
  target: string // raw word
}
export interface Cmd {
  words: string[] // raw words
  redirs: Redirect[]
}
export interface Item {
  pipeline: Cmd[]
  /** How this item connects to the next one. */
  next: ';' | '&&' | '||' | null
}

export function parse(tokens: Token[]): Item[] {
  const items: Item[] = []
  let pipeline: Cmd[] = []
  let cmd: Cmd = { words: [], redirs: [] }

  const finishCmd = (opName: string) => {
    if (cmd.words.length === 0 && cmd.redirs.length === 0) {
      throw new SyntaxError_(`erro de sintaxe perto do token '${opName}'`)
    }
    pipeline.push(cmd)
    cmd = { words: [], redirs: [] }
  }

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] as Token
    if (tok.t === 'word') {
      cmd.words.push(tok.raw)
      continue
    }
    switch (tok.op) {
      case '|':
        finishCmd('|')
        break
      case ';':
      case '&&':
      case '||': {
        if (cmd.words.length === 0 && cmd.redirs.length === 0 && pipeline.length === 0) {
          if (tok.op === ';' && items.length > 0) break // tolerate "a;; b"-ish stray separators
          throw new SyntaxError_(`erro de sintaxe perto do token '${tok.op}'`)
        }
        finishCmd(tok.op)
        items.push({ pipeline, next: tok.op })
        pipeline = []
        break
      }
      case '>':
      case '>>': {
        const target = tokens[i + 1]
        if (!target || target.t !== 'word') {
          throw new SyntaxError_("erro de sintaxe perto do token 'newline'")
        }
        cmd.redirs.push({ op: tok.op, target: target.raw })
        i++
        break
      }
      case '<':
        throw new SyntaxError_("redirecionamento de entrada '<' não é suportado aqui")
    }
  }

  if (cmd.words.length > 0 || cmd.redirs.length > 0) {
    pipeline.push(cmd)
  } else if (pipeline.length > 0) {
    throw new SyntaxError_("erro de sintaxe perto do token '|'") // dangling pipe
  }
  if (pipeline.length > 0) items.push({ pipeline, next: null })

  // A trailing "&&" / "||" with nothing after it is a syntax error; a trailing ";" is fine.
  const last = items[items.length - 1]
  if (last && last.next !== null) {
    if (last.next === ';') last.next = null
    else throw new SyntaxError_("erro de sintaxe perto do token 'newline'")
  }
  return items
}

// --- expansion ---

export interface Expanded {
  value: string
  /** `value` with literal glob characters escaped, only meaningful when `glob` is true. */
  pattern: string
  glob: boolean
}

export interface ExpandEnv {
  get(name: string): string
  status: number
  home: string
}

const escapeGlob = (c: string) => (c === '*' || c === '?' || c === '\\' ? '\\' + c : c)

export function expandWord(raw: string, env: ExpandEnv): Expanded {
  let value = ''
  let pattern = ''
  let glob = false
  let i = 0

  const lit = (s: string) => {
    value += s
    for (const c of s) pattern += escapeGlob(c)
  }

  const readVar = (): string | null => {
    // at raw[i] === '$'
    const next = raw[i + 1]
    if (next === '?') {
      i += 2
      return String(env.status)
    }
    if (next === '{') {
      const end = raw.indexOf('}', i + 2)
      if (end < 0) return null
      const name = raw.slice(i + 2, end)
      i = end + 1
      return env.get(name)
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw.slice(i + 1))
    if (!m) return null
    i += 1 + m[0].length
    return env.get(m[0])
  }

  if (raw === '~' || raw.startsWith('~/')) {
    lit(env.home)
    i = 1
  }

  while (i < raw.length) {
    const c = raw[i] as string
    if (c === '\\') {
      lit(raw[i + 1] ?? '\\')
      i += 2
    } else if (c === "'") {
      const end = raw.indexOf("'", i + 1)
      lit(raw.slice(i + 1, end < 0 ? raw.length : end))
      i = end < 0 ? raw.length : end + 1
    } else if (c === '"') {
      i++
      while (i < raw.length && raw[i] !== '"') {
        const d = raw[i] as string
        if (d === '\\' && '$"\\`'.includes(raw[i + 1] ?? '')) {
          lit(raw[i + 1] as string)
          i += 2
        } else if (d === '$') {
          const v = readVar()
          if (v === null) {
            lit('$')
            i++
          } else lit(v)
        } else {
          lit(d)
          i++
        }
      }
      i++ // closing quote
    } else if (c === '$') {
      const v = readVar()
      if (v === null) {
        lit('$')
        i++
      } else lit(v)
    } else if (c === '*' || c === '?') {
      value += c
      pattern += c
      glob = true
      i++
    } else {
      lit(c)
      i++
    }
  }
  return { value, pattern, glob }
}

/** Compile a glob pattern (as produced by expandWord) into a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string
    if (c === '\\') {
      re += escapeRe(pattern[++i] ?? '\\')
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += escapeRe(c)
  }
  return new RegExp(`^${re}$`)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
