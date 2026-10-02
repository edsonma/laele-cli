import { describe, expect, it } from 'vitest'
import { VFS } from './vfs'

describe('VFS', () => {
  it('normalizes paths', () => {
    const v = new VFS()
    expect(v.normalize('a/../b/./c', '/x')).toBe('/x/b/c')
    expect(v.normalize('/a//b/', '/')).toBe('/a/b')
    expect(v.normalize('../../..', '/a')).toBe('/')
  })
  it('creates, reads and appends files', () => {
    const v = new VFS()
    expect(v.mkdir('/d')).toBeNull()
    expect(v.writeFile('/d/f', 'a')).toBeNull()
    expect(v.writeFile('/d/f', 'b', true)).toBeNull()
    expect(v.readFile('/d/f')).toEqual({ ok: true, content: 'ab' })
    expect(v.readFile('/d')).toEqual({ ok: false, error: 'EISDIR' })
    expect(v.readFile('/nope')).toEqual({ ok: false, error: 'ENOENT' })
  })
  it('reports errors', () => {
    const v = new VFS()
    expect(v.writeFile('/no/such/f', 'x')).toBe('ENOENT')
    v.writeFile('/f', 'x')
    expect(v.mkdir('/f')).toBe('EEXIST')
    expect(v.mkdir('/f/g')).toBe('ENOTDIR')
    expect(v.readdir('/f')).toBe('ENOTDIR')
  })
  it('mkdir -p builds parents and tolerates existing dirs', () => {
    const v = new VFS()
    expect(v.mkdir('/a/b/c', true)).toBeNull()
    expect(v.mkdir('/a/b/c', true)).toBeNull()
    expect(v.isDir('/a/b/c')).toBe(true)
  })
  it('remove needs recursive for directories', () => {
    const v = new VFS()
    v.mkdir('/d')
    v.writeFile('/d/f', 'x')
    expect(v.remove('/d')).toBe('EISDIR')
    expect(v.remove('/d', true)).toBeNull()
    expect(v.get('/d')).toBeUndefined()
    expect(v.remove('/d')).toBe('ENOENT')
  })
  it('copy is deep and move relocates', () => {
    const v = new VFS()
    v.mkdir('/a')
    v.writeFile('/a/f', 'x')
    expect(v.copy('/a', '/b')).toBeNull()
    v.writeFile('/b/f', 'changed')
    expect(v.readFile('/a/f')).toEqual({ ok: true, content: 'x' })
    expect(v.move('/b', '/c')).toBeNull()
    expect(v.get('/b')).toBeUndefined()
    expect(v.readFile('/c/f')).toEqual({ ok: true, content: 'changed' })
  })
  it('refuses to copy a directory into itself', () => {
    const v = new VFS()
    v.mkdir('/a')
    expect(v.copy('/a', '/a/b')).toBe('EINVAL')
  })
  it('readdir is sorted', () => {
    const v = new VFS()
    for (const n of ['b', 'a', 'C']) v.writeFile('/' + n, '')
    expect(v.readdir('/')).toEqual(['a', 'b', 'C'])
  })
})
