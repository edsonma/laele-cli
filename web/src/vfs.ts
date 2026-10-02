// A tiny in-memory filesystem. Paths are POSIX style and always normalized.

export type FsError = 'ENOENT' | 'EISDIR' | 'ENOTDIR' | 'EEXIST' | 'ENOTEMPTY' | 'EINVAL'

export interface FileNode {
  type: 'file'
  content: string
  mtime: Date
}
export interface DirNode {
  type: 'dir'
  children: Map<string, Node>
  mtime: Date
}
export type Node = FileNode | DirNode

export const fsErrorText: Record<FsError, string> = {
  ENOENT: 'Arquivo ou diretório inexistente',
  EISDIR: 'É um diretório',
  ENOTDIR: 'Não é um diretório',
  EEXIST: 'O arquivo já existe',
  ENOTEMPTY: 'O diretório não está vazio',
  EINVAL: 'Argumento inválido',
}

export class VFS {
  root: DirNode

  constructor(private now: () => Date = () => new Date()) {
    this.root = { type: 'dir', children: new Map(), mtime: now() }
  }

  /** Resolve `path` against `cwd`, collapsing `.`, `..` and repeated slashes. */
  normalize(path: string, cwd = '/'): string {
    const parts = (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')
    const out: string[] = []
    for (const p of parts) {
      if (p === '' || p === '.') continue
      if (p === '..') out.pop()
      else out.push(p)
    }
    return '/' + out.join('/')
  }

  get(abs: string): Node | undefined {
    let node: Node = this.root
    for (const part of abs.split('/').filter(Boolean)) {
      if (node.type !== 'dir') return undefined
      const next = node.children.get(part)
      if (!next) return undefined
      node = next
    }
    return node
  }

  private split(abs: string): { parent: string; name: string } {
    const i = abs.lastIndexOf('/')
    return { parent: i <= 0 ? '/' : abs.slice(0, i), name: abs.slice(i + 1) }
  }

  isDir(abs: string): boolean {
    return this.get(abs)?.type === 'dir'
  }

  readFile(abs: string): { ok: true; content: string } | { ok: false; error: FsError } {
    const n = this.get(abs)
    if (!n) return { ok: false, error: 'ENOENT' }
    if (n.type === 'dir') return { ok: false, error: 'EISDIR' }
    return { ok: true, content: n.content }
  }

  readdir(abs: string): string[] | FsError {
    const n = this.get(abs)
    if (!n) return 'ENOENT'
    if (n.type !== 'dir') return 'ENOTDIR'
    return [...n.children.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }

  writeFile(abs: string, content: string, append = false): FsError | null {
    const { parent, name } = this.split(abs)
    if (!name) return 'EISDIR'
    const dir = this.get(parent)
    if (!dir) return 'ENOENT'
    if (dir.type !== 'dir') return 'ENOTDIR'
    const existing = dir.children.get(name)
    if (existing?.type === 'dir') return 'EISDIR'
    const mtime = this.now()
    if (existing) {
      existing.content = append ? existing.content + content : content
      existing.mtime = mtime
    } else {
      dir.children.set(name, { type: 'file', content, mtime })
    }
    dir.mtime = mtime
    return null
  }

  mkdir(abs: string, parents = false): FsError | null {
    if (abs === '/') return parents ? null : 'EEXIST'
    const { parent, name } = this.split(abs)
    if (parents && !this.get(parent)) {
      const err = this.mkdir(parent, true)
      if (err) return err
    }
    const dir = this.get(parent)
    if (!dir) return 'ENOENT'
    if (dir.type !== 'dir') return 'ENOTDIR'
    const existing = dir.children.get(name)
    if (existing) return parents && existing.type === 'dir' ? null : 'EEXIST'
    dir.children.set(name, { type: 'dir', children: new Map(), mtime: this.now() })
    return null
  }

  remove(abs: string, recursive = false): FsError | null {
    const { parent, name } = this.split(abs)
    const dir = this.get(parent)
    const node = dir?.type === 'dir' ? dir.children.get(name) : undefined
    if (!dir || dir.type !== 'dir' || !node) return 'ENOENT'
    if (node.type === 'dir' && !recursive) return 'EISDIR'
    dir.children.delete(name)
    return null
  }

  /** Deep-copy `src` into `dest` (dest must not be an existing directory). */
  copy(src: string, dest: string): FsError | null {
    const node = this.get(src)
    if (!node) return 'ENOENT'
    if (node.type === 'dir' && (dest === src || dest.startsWith(src + '/'))) return 'EINVAL'
    const { parent, name } = this.split(dest)
    const dir = this.get(parent)
    if (!dir) return 'ENOENT'
    if (dir.type !== 'dir') return 'ENOTDIR'
    const existing = dir.children.get(name)
    if (existing && (existing.type === 'dir') !== (node.type === 'dir')) {
      return existing.type === 'dir' ? 'EISDIR' : 'ENOTDIR'
    }
    dir.children.set(name, clone(node, this.now()))
    return null
  }

  move(src: string, dest: string): FsError | null {
    if (src === '/' || src === dest) return 'EINVAL'
    const err = this.copy(src, dest)
    if (err) return err
    return this.remove(src, true)
  }
}

function clone(n: Node, mtime: Date): Node {
  if (n.type === 'file') return { type: 'file', content: n.content, mtime }
  const children = new Map<string, Node>()
  for (const [k, v] of n.children) children.set(k, clone(v, mtime))
  return { type: 'dir', children, mtime }
}
