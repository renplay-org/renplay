import { inflateSync } from 'node:zlib'
import { PyObject, unpickle, walkPickle } from '../util/pickle.js'

const RPYC2_HEADER = Buffer.from('RENPY RPC2')

/** Returns slot 1 (the AST) of a .rpyc file, decompressed. */
export function rpycAst(data: Buffer): Buffer | null {
  try {
    if (!data.subarray(0, RPYC2_HEADER.length).equals(RPYC2_HEADER)) return inflateSync(data)
    let pos = RPYC2_HEADER.length
    while (pos + 12 <= data.length) {
      const slot = data.readUInt32LE(pos)
      const start = data.readUInt32LE(pos + 4)
      const length = data.readUInt32LE(pos + 8)
      if (slot === 0) return null
      if (slot === 1) return inflateSync(data.subarray(start, start + length))
      pos += 12
    }
  } catch {}
  return null
}

/** Parses a Python string literal (the common subset Ren'Py scripts use). */
export function pyStringLiteral(src: string): string | null {
  const m = src.trim().match(/^[rRuUbB]?("""|'''|"|')([\s\S]*)\1$/)
  if (!m) return null
  const raw = /^[rR]/.test(src.trim())
  const body = m[2]!
  if (raw) return body
  return body.replace(/\\(["'\\nt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
}

const SAVE_DIR_RE = /(?:^|[\s;])(?:define\s+)?config\.save_directory\s*=\s*(?:_\(\s*)?(r?(?:"[^"\n]*"|'[^'\n]*'))/m

export function saveDirFromSource(src: string): string | null {
  const m = src.match(SAVE_DIR_RE)
  if (!m) return null
  return pyStringLiteral(m[1]!)
}

/** Scans a compiled script for `define config.save_directory` or an equivalent python assignment. */
export function saveDirFromRpyc(data: Buffer): string | null {
  const ast = rpycAst(data)
  if (!ast) return null
  // Cheap pre-check before unpickling the whole AST.
  if (!ast.includes('save_directory')) return null
  let root: unknown
  try {
    root = unpickle(ast)
  } catch {
    return null
  }
  let found: string | null = null
  walkPickle(root, (v) => {
    if (found || !(v instanceof PyObject)) return
    if (v.cls === 'renpy.ast.Define') {
      const varname = v.attr('varname')
      const store = v.attr('store')
      if (varname === 'save_directory' && (store === 'store.config' || store === 'config')) {
        const code = v.attr('code')
        const text = code instanceof PyObject ? pyExprText(pyCodeSource(code)) : null
        if (text) found = pyStringLiteral(text)
      }
    } else if (v.cls === 'renpy.ast.PyCode') {
      const text = pyExprText(pyCodeSource(v))
      if (text) found = saveDirFromSource(text)
    }
  })
  return found
}

/** PyCode pickles as (version, source, location, mode, py) in Ren'Py 7/8. */
function pyCodeSource(code: PyObject): unknown {
  const named = code.attr('source')
  if (named !== undefined) return named
  const st = code.state
  if (Array.isArray(st) && typeof st[0] === 'number') return st[1]
  return undefined
}

function pyExprText(v: unknown): string | null {
  if (typeof v === 'string') return v
  // renpy.ast.PyExpr is a str subclass pickled with its constructor args.
  if (v instanceof PyObject && typeof v.args[0] === 'string') return v.args[0]
  return null
}

const NAME_RE = /define\s+config\.name\s*=\s*_?\(?\s*(r?(?:"[^"\n]*"|'[^'\n]*'))/
const VERSION_RE = /define\s+config\.version\s*=\s*_?\(?\s*(r?(?:"[^"\n]*"|'[^'\n]*'))/

export function nameVersionFromSource(src: string): { name?: string; version?: string } {
  const n = src.match(NAME_RE)
  const v = src.match(VERSION_RE)
  return {
    name: n ? (pyStringLiteral(n[1]!) ?? undefined) : undefined,
    version: v ? (pyStringLiteral(v[1]!) ?? undefined) : undefined,
  }
}

export interface GameMeta {
  title?: string
  version?: string
  renpyVersion?: string
  saveDir?: string
  screen?: [number, number]
}

/**
 * The Ren'Py version: `version = '8.3.4.24120703'` in renpy/vc_version.py, or
 * for Ren'Py 7 and older, whose vc_version.py only has `vc_version = 320`,
 * `version_tuple = (7, 3, 2, vc_version)` from renpy/__init__.py.
 */
export function renpyVersionFromVc(vc: string, init?: string): string | undefined {
  const m = vc.match(/^version\s*=\s*['"]([^'"]+)['"]/m)
  if (m) return m[1]
  const t = init?.match(/^version_tuple\s*=\s*\((\d+),\s*(\d+),\s*(\d+)/m)
  if (!t) return undefined
  const n = vc.match(/^vc_version\s*=\s*(\d+)/m)
  return `${t[1]}.${t[2]}.${t[3]}${n ? `.${n[1]}` : ''}`
}

/** Whether a version string needs renpy/__init__.py to be read as well. */
export const vcNeedsInit = (vc: string) => !/^version\s*=/m.test(vc)
