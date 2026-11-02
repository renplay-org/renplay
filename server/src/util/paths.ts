import { isAbsolute, join, normalize, relative, sep } from 'node:path'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/

export function isSlug(s: unknown): s is string {
  return typeof s === 'string' && SLUG_RE.test(s) && !s.includes('..')
}

export function assertSlug(s: unknown): string {
  if (!isSlug(s)) throw new HttpError(400, 'Invalid game id')
  return s
}

export function slugify(input: string): string {
  const s = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return s || 'game'
}

/**
 * Validates a relative POSIX path coming from a client or an archive.
 * Rejects absolute paths, `..`, empty segments, NUL and backslashes.
 */
export function cleanRelPath(p: unknown, opts: { allowEmpty?: boolean } = {}): string {
  if (typeof p !== 'string') throw new HttpError(400, 'Invalid path')
  let s = p.replace(/\\/g, '/').replace(/^\.\/+/, '')
  s = s.replace(/\/+/g, '/').replace(/\/$/, '')
  if (!s) {
    if (opts.allowEmpty) return ''
    throw new HttpError(400, 'Empty path')
  }
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s) || s.includes('\0')) throw new HttpError(400, 'Absolute path not allowed')
  for (const seg of s.split('/')) {
    if (!seg || seg === '.' || seg === '..') throw new HttpError(400, 'Invalid path segment')
  }
  if (s.length > 1024) throw new HttpError(400, 'Path too long')
  return s
}

/** Joins `rel` under `base` and guarantees the result stays inside `base`. */
export function safeJoin(base: string, rel: string): string {
  const full = normalize(join(base, rel))
  const r = relative(base, full)
  if (r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r))) return full
  throw new HttpError(400, 'Path escapes base directory')
}

/** Save directory names as Ren'Py uses them (config.save_directory). */
export function isSaveDirName(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 200 && !/[\/\\\0]/.test(s) && s !== '.' && s !== '..'
}
