import { describe, expect, it } from 'vitest'
import { entries, fold, inject, makeLine, parseMode, search } from './slang'

const L = () => '<S>\n'

describe('inject (mirrors the Go filter)', () => {
  it('before: slang first', () => {
    expect(inject('a\nb\n', 'before', L)).toBe('<S>\na\nb\n')
  })
  it('middle: after the first line', () => {
    expect(inject('a\nb\nc\n', 'middle', L)).toBe('a\n<S>\nb\nc\n')
  })
  it('middle with a single line goes after it', () => {
    expect(inject('only', 'middle', L)).toBe('only\n<S>\n')
    expect(inject('only\n', 'middle', L)).toBe('only\n<S>\n')
  })
  it('after: at the end, adding a newline if needed', () => {
    expect(inject('a\nb\n', 'after', L)).toBe('a\nb\n<S>\n')
    expect(inject('foo', 'after', L)).toBe('foo\n<S>\n')
  })
  it('leaves empty output alone in every mode', () => {
    for (const m of ['before', 'middle', 'after', 'random'] as const) expect(inject('', m, L)).toBe('')
  })
  it('random picks one of the three placements', () => {
    const seen = new Set<string>()
    for (const r of [0, 0.4, 0.9]) seen.add(inject('a\nb\n', 'random', L, () => r))
    expect(seen).toEqual(new Set(['<S>\na\nb\n', 'a\n<S>\nb\n', 'a\nb\n<S>\n']))
  })
})

describe('slang data', () => {
  it('has at least the original 17 terms, each complete', () => {
    expect(entries.length).toBeGreaterThanOrEqual(17)
    for (const e of entries) {
      expect(e.term).not.toBe('')
      expect(e.meaning).not.toBe('')
      expect(e.phrases.length).toBeGreaterThan(0)
    }
  })
  it('makeLine adds a dim meaning line on request', () => {
    expect(makeLine(false, () => 0).split('\n').filter(Boolean)).toHaveLength(1)
    const two = makeLine(true, () => 0).split('\n').filter(Boolean)
    expect(two).toHaveLength(2)
    expect(two[1]).toContain(entries[0]!.term)
  })
  it('search ignores accents and case', () => {
    expect(fold('Pegar a VISÃO')).toBe('pegar a visao')
    expect(search('visao').some((e) => e.term === 'Pegar a visão')).toBe(true)
    expect(search('   ')).toEqual([])
  })
  it('parseMode only accepts known modes', () => {
    expect(parseMode('middle')).toBe('middle')
    expect(parseMode('nope')).toBeUndefined()
  })
})
