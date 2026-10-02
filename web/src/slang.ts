// Slang data is shared with the Go CLI: ../../slang.json
import raw from '../../slang.json'

export interface Entry {
  term: string
  meaning: string
  phrases: string[]
}

export const entries: Entry[] = raw as Entry[]

export type Mode = 'before' | 'middle' | 'after' | 'random'
export const MODES: Mode[] = ['before', 'middle', 'after', 'random']

export function parseMode(s: string): Mode | undefined {
  return MODES.find((m) => m === s)
}

export type Rng = () => number

const pick = <T>(xs: readonly T[], rng: Rng): T => xs[Math.floor(rng() * xs.length)] as T

// Truecolor "dendê" orange for the slang, dim for the meaning.
const SLANG_ON = '\x1b[1;38;2;255;138;42m'
const DIM_ON = '\x1b[2m'
const OFF = '\x1b[0m'

/** Build one slang line (ends with \n). With `meaning`, a second dim line explains the term. */
export function makeLine(meaning: boolean, rng: Rng = Math.random): string {
  const e = pick(entries, rng)
  const phrase = e.phrases.length > 0 ? pick(e.phrases, rng) : `${e.term}, viu!`
  let s = `${SLANG_ON}🌴 ${phrase}${OFF}\n`
  if (meaning) s += `${DIM_ON}   ↳ ${e.term}: ${e.meaning}${OFF}\n`
  return s
}

/**
 * Insert a slang line into a command's output, following the same rules as the
 * Go CLI: `before` puts it ahead of the output, `middle` after the first line,
 * `after` at the end. Empty output is left alone.
 */
export function inject(output: string, mode: Mode, line: () => string, rng: Rng = Math.random): string {
  if (output === '') return output
  const m: Exclude<Mode, 'random'> = mode === 'random' ? pick(['before', 'middle', 'after'] as const, rng) : mode
  switch (m) {
    case 'before':
      return line() + output
    case 'middle': {
      const i = output.indexOf('\n')
      if (i < 0) return output + '\n' + line()
      return output.slice(0, i + 1) + line() + output.slice(i + 1)
    }
    case 'after':
      return (output.endsWith('\n') ? output : output + '\n') + line()
  }
}

/** Lowercase and strip accents so "Pega a visao" finds "Pega a visão". */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function search(query: string): Entry[] {
  const q = fold(query.trim())
  if (!q) return []
  return entries.filter((e) => fold(e.term).includes(q) || fold(e.meaning).includes(q))
}
