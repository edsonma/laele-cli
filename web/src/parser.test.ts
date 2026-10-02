import { describe, expect, it } from 'vitest'
import { expandWord, globToRegExp, parse, tokenize } from './parser'

const env = (vars: Record<string, string> = {}, status = 0) => ({
  get: (n: string) => vars[n] ?? '',
  status,
  home: '/home/visitante',
})
const words = (line: string) => tokenize(line).map((t) => (t.t === 'word' ? t.raw : t.op))

describe('tokenize', () => {
  it('splits words and operators', () => {
    expect(words('ls -la | grep x && echo ok; pwd > f')).toEqual(['ls', '-la', '|', 'grep', 'x', '&&', 'echo', 'ok', ';', 'pwd', '>', 'f'])
  })
  it('keeps quoted text together, operators inside quotes included', () => {
    expect(words(`echo "a | b" 'c;d' e\\ f`)).toEqual(['echo', '"a | b"', "'c;d'", 'e\\ f'])
  })
  it('works without spaces around operators', () => {
    expect(words('a;b&&c||d|e>f>>g')).toEqual(['a', ';', 'b', '&&', 'c', '||', 'd', '|', 'e', '>', 'f', '>>', 'g'])
  })
  it('stops at a comment', () => {
    expect(words('echo hi # not this')).toEqual(['echo', 'hi'])
  })
  it('rejects unterminated quotes', () => {
    expect(() => tokenize('echo "abc')).toThrow(/aspas/)
    expect(() => tokenize("echo 'abc")).toThrow(/aspas/)
  })
})

describe('parse', () => {
  it('builds pipelines and lists', () => {
    const items = parse(tokenize('a | b && c; d'))
    expect(items.map((i) => i.pipeline.length)).toEqual([2, 1, 1])
    expect(items.map((i) => i.next)).toEqual(['&&', ';', null])
  })
  it('collects redirections', () => {
    const [item] = parse(tokenize('echo hi > out.txt'))
    expect(item!.pipeline[0]).toEqual({ words: ['echo', 'hi'], redirs: [{ op: '>', target: 'out.txt' }] })
  })
  it('allows a trailing semicolon', () => {
    expect(parse(tokenize('ls;'))).toHaveLength(1)
  })
  it.each(['| a', 'a |', 'a &&', '&& a', 'a >', '|| |'])('rejects %j', (line) => {
    expect(() => parse(tokenize(line))).toThrow()
  })
})

describe('expandWord', () => {
  it('expands variables, in double quotes but not single', () => {
    const e = env({ NOME: 'Mara' })
    expect(expandWord('$NOME', e).value).toBe('Mara')
    expect(expandWord('"oi, ${NOME}!"', e).value).toBe('oi, Mara!')
    expect(expandWord("'$NOME'", e).value).toBe('$NOME')
    expect(expandWord('$INEXISTENTE', e).value).toBe('')
    expect(expandWord('5$', e).value).toBe('5$')
  })
  it('expands $? and ~', () => {
    expect(expandWord('$?', env({}, 3)).value).toBe('3')
    expect(expandWord('~/x', env()).value).toBe('/home/visitante/x')
    expect(expandWord('a~', env()).value).toBe('a~')
  })
  it('handles escapes', () => {
    expect(expandWord('a\\ b', env()).value).toBe('a b')
    expect(expandWord('"a\\"b"', env()).value).toBe('a"b')
  })
  it('flags only unquoted globs', () => {
    expect(expandWord('*.txt', env()).glob).toBe(true)
    expect(expandWord('"*.txt"', env()).glob).toBe(false)
    expect(expandWord('\\*', env()).glob).toBe(false)
  })
  it('globToRegExp matches * and ? within a segment', () => {
    const re = globToRegExp('a?c*.txt')
    expect(re.test('abc.txt')).toBe(true)
    expect(re.test('abcdef.txt')).toBe(true)
    expect(re.test('ac.txt')).toBe(false)
    expect(globToRegExp('a\\*b').test('a*b')).toBe(true)
    expect(globToRegExp('a\\*b').test('axb')).toBe(false)
    expect(globToRegExp('a.b').test('axb')).toBe(false)
  })
})
