import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WEB_COMPAT } from '../pipeline/webcompat.js'

// Runs Renplay's `python early` block the way the engine does, with a Python in which
// `sys.platform` is emscripten and a urllib3 shaped like the one Ren'Py 8.5 bundles.
function runGame(dir: string, game: string): string {
  const block = WEB_COMPAT.split('\n').slice(WEB_COMPAT.split('\n').indexOf('python early:') + 1)
  const body = block.map((line) => line.replace(/^ {4}/, '')).join('\n')
  const script = [
    'import sys, types',
    `sys.path.insert(0, ${JSON.stringify(dir)})`,
    'sys.platform = "emscripten"',
    'renpy = types.SimpleNamespace(emscripten=True, python=types.SimpleNamespace(py_compile=compile))',
    'exec(' + JSON.stringify(body) + ', {"renpy": renpy})',
    game,
  ].join('\n')
  return execFileSync('python3', ['-I', '-c', script], { encoding: 'utf8' }).trim()
}

function bundledUrllib3(dir: string): void {
  const files: Record<string, string> = {
    'urllib3/__init__.py': 'import sys\nif sys.platform == "emscripten":\n    from .contrib.emscripten import inject_into_urllib3\n    inject_into_urllib3()\nconnection = "sockets"\n',
    'urllib3/contrib/__init__.py': '',
    'urllib3/contrib/emscripten/__init__.py': 'from .connection import inject_into_urllib3\n',
    'urllib3/contrib/emscripten/connection.py': 'from .fetch import send\n\ndef inject_into_urllib3():\n    pass\n',
    'urllib3/contrib/emscripten/fetch.py': 'import js\n\ndef send():\n    return js\n',
    'requests.py': 'import urllib3\nname = "requests"\n',
  }
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
}

describe('web compatibility script', () => {
  it('lets a game import requests, which keeps urllib3’s ordinary socket code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'webcompat-'))
    try {
      bundledUrllib3(dir)
      const out = runGame(dir, 'import requests, urllib3\nprint(requests.name, urllib3.connection)')
      expect(out).toBe('requests sockets')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
