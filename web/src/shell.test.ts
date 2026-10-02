import { beforeEach, describe, expect, it } from 'vitest'
import { Shell } from './shell'
import { entries } from './slang'

const ANSI = /\x1b\[[0-9;]*m/g
const strip = (s: string) => s.replace(ANSI, '')

let sh: Shell
beforeEach(() => {
  sh = new Shell(() => 0, () => new Date(2026, 9, 2, 10, 30))
})

/** Run a line and return its output without ANSI and without the slang line. */
const run = (line: string, cols = 80): string =>
  strip(sh.execute(line, cols).output)
    .split('\n')
    .filter((l) => !l.startsWith('🌴'))
    .join('\n')

const status = () => sh.status

describe('basics', () => {
  it('echo, quotes and variables', () => {
    expect(run('echo oi   mundo')).toBe('oi mundo\n')
    expect(run('echo "a   b"')).toBe('a   b\n')
    expect(run('NOME=Mara; echo "oi, $NOME"')).toBe('oi, Mara\n')
    expect(run("echo '$NOME'")).toBe('$NOME\n')
    expect(run('echo -n sem')).toBe('sem') // the line editor, not the shell, adds the final newline
  })
  it('unknown command gives 127', () => {
    expect(run('xyzzy')).toBe('bash: xyzzy: comando não encontrado\n')
    expect(status()).toBe(127)
    expect(run('echo $?')).toBe('127\n')
  })
  it('empty input does nothing', () => {
    expect(sh.execute('   ').output).toBe('')
    expect(sh.history).toEqual([])
  })
  it('syntax errors are reported, not thrown', () => {
    expect(run('echo "abc')).toMatch(/^bash: aspas não fechadas/)
    expect(status()).toBe(2)
    expect(run('echo |')).toMatch(/erro de sintaxe/)
  })
  it("builtin names can't be hijacked through Object.prototype", () => {
    expect(run('constructor')).toContain('comando não encontrado')
    expect(run('toString')).toContain('comando não encontrado')
  })
})

describe('lists', () => {
  it('; always continues', () => {
    expect(run('false; echo ok')).toBe('ok\n')
  })
  it('&& and || short-circuit like bash', () => {
    expect(run('true && echo a')).toBe('a\n')
    expect(run('false && echo a')).toBe('')
    expect(run('false || echo b')).toBe('b\n')
    expect(run('true || echo b')).toBe('')
    expect(run('false && echo a || echo b')).toBe('b\n')
    expect(run('true || echo a && echo b')).toBe('b\n')
  })
  it('$? sees the previous command inside the same line', () => {
    expect(run('false; echo $?')).toBe('1\n')
  })
})

describe('files, pipes and redirects', () => {
  it('writes, appends and reads back', () => {
    run('echo um > f.txt')
    run('echo dois >> f.txt')
    expect(run('cat f.txt')).toBe('um\ndois\n')
    run('echo novo > f.txt')
    expect(run('cat f.txt')).toBe('novo\n')
  })
  it('redirect output is not shown and carries no colors', () => {
    expect(run('ls > lista.txt')).toBe('')
    expect(run('cat lista.txt')).not.toMatch(/\x1b/)
    expect(run('cat lista.txt')).toContain('README.md')
  })
  it('pipes feed stdin', () => {
    expect(run('echo a b c | wc -w')).toBe('      3\n')
    expect(run('cat giria.txt | grep -i "boca de me" | wc -l')).toBe('      1\n')
    expect(run('echo b; echo a | sort')).toBe('b\na\n')
  })
  it('cat reports missing files and keeps going', () => {
    const out = run('cat nada README.md')
    expect(out).toContain('cat: nada: Arquivo ou diretório inexistente')
    expect(out).toContain('laele')
    expect(status()).toBe(1)
  })
  it('refuses to redirect into a directory or a missing path', () => {
    expect(run('echo x > Pelourinho')).toContain('É um diretório')
    expect(run('echo x > nao/existe/f')).toContain('inexistente')
  })
  it('cp and mv', () => {
    run('echo x > a; cp a b; mv b c')
    expect(run('ls')).toMatch(/\ba\b/)
    expect(run('cat c')).toBe('x\n')
    expect(run('cat b')).toContain('inexistente')
    run('cp -r Pelourinho copia')
    expect(run('ls copia')).toContain('acaraje.txt')
    expect(run('cp Pelourinho outra')).toContain('-r não especificado')
  })
  it('mkdir -p, touch, rm', () => {
    run('mkdir -p a/b/c; touch a/b/c/f')
    expect(run('ls a/b/c')).toBe('f\n')
    expect(run('rm a')).toContain('É um diretório')
    run('rm -r a')
    expect(run('ls a')).toContain('inexistente')
    expect(run('rm -f nada')).toBe('')
    expect(status()).toBe(0)
  })
})

describe('globs', () => {
  beforeEach(() => {
    run('touch a.txt b.txt c.md')
  })
  it('expands * and ? in the last path segment', () => {
    expect(run('echo *.txt')).toBe('a.txt b.txt giria.txt\n') // giria.txt ships in the home dir
    expect(run('echo ?.md')).toBe('c.md\n')
    expect(run('echo Pelourinho/*.txt').split(' ')[0]).toBe('Pelourinho/acaraje.txt')
  })
  it('hides dotfiles unless the pattern starts with a dot', () => {
    expect(run('echo *rc')).toBe('*rc\n')
    expect(run('echo .*rc')).toBe('.bashrc\n')
  })
  it('leaves unmatched and quoted patterns alone', () => {
    expect(run('echo *.zip')).toBe('*.zip\n')
    expect(run('echo "*.txt"')).toBe('*.txt\n')
  })
})

describe('navigation', () => {
  it('cd, pwd, cd - and ~', () => {
    run('cd Pelourinho')
    expect(run('pwd')).toBe('/home/visitante/Pelourinho\n')
    expect(sh.prompt().length).toBe('visitante@salvador:~/Pelourinho$ '.length)
    run('cd /tmp')
    expect(run('cd -')).toBe('/home/visitante/Pelourinho\n')
    run('cd')
    expect(run('pwd')).toBe('/home/visitante\n')
    run('cd /etc; cd ~/Pelourinho')
    expect(run('pwd')).toBe('/home/visitante/Pelourinho\n')
  })
  it('cd errors', () => {
    expect(run('cd nada')).toContain('Arquivo ou diretório inexistente')
    expect(run('cd README.md')).toContain('Não é um diretório')
    expect(status()).toBe(1)
  })
  it('relative paths and ..', () => {
    run('cd Pelourinho; cd ..; cd ./Pelourinho/..')
    expect(run('pwd')).toBe('/home/visitante\n')
  })
})

describe('ls', () => {
  it('hides dotfiles, -a shows them, piped output is one per line and plain', () => {
    expect(run('ls')).not.toContain('.bashrc')
    expect(run('ls -a')).toContain('.bashrc')
    const piped = run('ls | cat')
    expect(piped.split('\n').filter(Boolean)).toEqual(['Capoeira', 'giria.txt', 'Pelourinho', 'README.md'])
    expect(sh.execute('ls | cat', 80).output).not.toMatch(/\x1b\[1;34m/)
  })
  it('colors directories only on the terminal', () => {
    expect(sh.execute('ls', 80).output).toContain('\x1b[1;34mPelourinho\x1b[0m')
  })
  it('-l has permissions, size and a date', () => {
    const out = run('ls -l')
    expect(out).toMatch(/^total \d+/)
    expect(out).toMatch(/drwxr-xr-x 1 visitante visitante\s+4096 out\s+2 10:30 Pelourinho/)
    expect(out).toMatch(/-rw-r--r-- 1 visitante visitante\s+\d+ out\s+2 10:30 README\.md/)
  })
  it('lays names out in columns that fit the width', () => {
    run('touch aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd')
    const wide = run('ls', 100).trimEnd().split('\n')
    const narrow = run('ls', 30).trimEnd().split('\n')
    expect(wide.length).toBeLessThan(narrow.length)
    for (const l of narrow) expect(l.length).toBeLessThanOrEqual(30)
  })
  it('missing path is an error with status 2', () => {
    expect(run('ls nada')).toBe("ls: não foi possível acessar 'nada': Arquivo ou diretório inexistente\n")
    expect(status()).toBe(2)
  })
  it('rejects unknown flags', () => {
    expect(run('ls -z')).toContain("opção inválida -- 'z'")
  })
})

describe('text tools', () => {
  beforeEach(() => {
    run('echo "banana\\nAbacate\\nbanana\\ncaju" > f; ')
    sh.vfs.writeFile('/home/visitante/f', 'banana\nAbacate\nbanana\ncaju\n')
  })
  it('grep: -i, -v, -c, -n, no match', () => {
    expect(run('grep ban f')).toBe('banana\nbanana\n')
    expect(run('grep -i abacate f')).toBe('Abacate\n')
    expect(run('grep -v ban f')).toBe('Abacate\ncaju\n')
    expect(run('grep -c ban f')).toBe('2\n')
    expect(run('grep -n caju f')).toBe('4:caju\n')
    expect(run('grep zzz f')).toBe('')
    expect(status()).toBe(1)
  })
  it('grep handles invalid regexes as literals and highlights only on the terminal', () => {
    sh.vfs.writeFile('/home/visitante/g', 'a(b\n')
    expect(run('grep "a(" g')).toBe('a(b\n')
    expect(sh.execute('grep ban f', 80).output).toContain('\x1b[1;31m')
    expect(sh.execute('grep ban f | cat', 80).output).not.toContain('\x1b[1;31m')
  })
  it('grep with several files prefixes names', () => {
    expect(run('grep -c caju f f')).toBe('f:1\nf:1\n')
  })
  it('head, tail, wc, sort', () => {
    expect(run('head -n 2 f')).toBe('banana\nAbacate\n')
    expect(run('tail -1 f')).toBe('caju\n')
    expect(run('wc -l f')).toBe('      4 f\n')
    expect(run('sort f')).toBe('Abacate\nbanana\nbanana\ncaju\n')
    expect(run('sort -ru f')).toBe('caju\nbanana\nAbacate\n')
    expect(run('head -n x f')).toContain('número de linhas inválido')
  })
})

describe('slang injection', () => {
  const first = entries[0]!.phrases[0]!

  it('before (default): slang line first, then the output', () => {
    const out = strip(sh.execute('echo oi').output)
    expect(out).toBe(`🌴 ${first}\noi\n`)
  })
  it('middle and after follow the CLI rules', () => {
    sh.setSettings({ mode: 'middle' })
    expect(strip(sh.execute('echo a; echo b').output)).toBe(`a\n🌴 ${first}\nb\n`)
    sh.setSettings({ mode: 'after' })
    expect(strip(sh.execute('echo a; echo b').output)).toBe(`a\nb\n🌴 ${first}\n`)
  })
  it('meaning adds the explanation line', () => {
    sh.setSettings({ meaning: true })
    const out = strip(sh.execute('echo oi').output)
    expect(out).toContain(`↳ ${entries[0]!.term}: ${entries[0]!.meaning}`)
  })
  it('no output means no slang', () => {
    expect(sh.execute('cd /tmp').output).toBe('')
    expect(sh.execute('true').output).toBe('')
    expect(sh.execute('echo hi > f').output).toBe('')
  })
  it('errors get slang too, like the CLI', () => {
    expect(strip(sh.execute('xyzzy').output)).toContain('🌴')
  })
  it('meta commands never get slang', () => {
    for (const l of ['laele', 'laele -mode after', 'giria', 'giria barril', 'history']) {
      expect(sh.execute(l).output, l).not.toContain('🌴')
    }
  })
  it('clear sets the flag and prints nothing', () => {
    const r = sh.execute('clear')
    expect(r.clear).toBe(true)
    expect(r.output).toBe('')
  })
  it('fullscreen programs are refused without slang-breaking the screen', () => {
    expect(run('vim x')).toContain('tela cheia')
    expect(status()).toBe(1)
  })
})

describe('laele and giria commands', () => {
  it('laele -mode changes the setting and notifies the UI', () => {
    let seen: string | undefined
    sh.onSettings = (s) => (seen = s.mode)
    expect(run('laele -mode after')).toContain('depois')
    expect(sh.settings.mode).toBe('after')
    expect(seen).toBe('after')
    run('laele -mode=random -meaning')
    expect(sh.settings).toEqual({ mode: 'random', meaning: true })
    run('laele -nomeaning')
    expect(sh.settings.meaning).toBe(false)
  })
  it('laele rejects bad input without changing anything', () => {
    expect(run('laele -mode sideways')).toContain('modo inválido')
    expect(run('laele -mode')).toContain('modo inválido')
    expect(run('laele -x')).toContain('opção desconhecida')
    expect(sh.settings).toEqual({ mode: 'before', meaning: false })
  })
  it('giria lists everything, searches without accents, and fails politely', () => {
    expect(run('giria').split('\n').filter((l) => l && !l.startsWith(' ')).length).toBe(entries.length)
    expect(run('giria visao')).toContain('Pegar a visão')
    expect(run('giria zzzz')).toContain('nenhuma gíria encontrada')
    expect(status()).toBe(1)
    expect(run('giria -r')).toMatch(/Ex\.:/)
  })
  it('giria.txt in the home directory has every term', () => {
    const lines = run('cat giria.txt').split('\n').filter(Boolean)
    expect(lines).toHaveLength(entries.length)
  })
})

describe('safety nets', () => {
  it('rm -rf / and friends are refused', () => {
    for (const l of ['rm -rf /', 'rm -rf /*', 'rm -rf ~', 'rm -rf /home']) {
      expect(run(l), l).toContain('Lá ele')
    }
    expect(run('ls')).toContain('README.md')
  })
  it('exit and sudo are jokes, not crashes', () => {
    expect(run('exit')).toContain('fechar a aba')
    expect(run('sudo ls')).toContain('Lá ele')
  })
})

describe('history and completion', () => {
  it('history skips consecutive duplicates and lines starting with a space', () => {
    run('ls'); run('ls'); run(' pwd'); run('echo x')
    expect(sh.history).toEqual(['ls', 'echo x'])
  })
  it('completes command names', () => {
    expect(sh.complete('gi', 2)).toEqual({ start: 0, candidates: ['giria'] })
    expect(sh.complete('ec', 2).candidates).toEqual(['echo'])
    expect(sh.complete('ls | gre', 8)).toEqual({ start: 5, candidates: ['grep'] })
  })
  it('completes paths, adding / to directories and hiding dotfiles', () => {
    expect(sh.complete('cat gi', 6)).toEqual({ start: 4, candidates: ['giria.txt'] })
    expect(sh.complete('cd Pel', 6).candidates).toEqual(['Pelourinho/'])
    expect(sh.complete('ls ~/Pelourinho/a', 17).candidates).toEqual(['~/Pelourinho/acaraje.txt'])
    expect(sh.complete('ls ', 3).candidates).not.toContain('.bashrc')
    expect(sh.complete('ls .b', 5).candidates).toEqual(['.bashrc'])
    expect(sh.complete('ls nada/x', 9).candidates).toEqual([])
  })
  it('completes after cd changes the directory', () => {
    run('cd Pelourinho')
    expect(sh.complete('cat el', 6).candidates).toEqual(['elevador-lacerda.txt'])
  })
})
