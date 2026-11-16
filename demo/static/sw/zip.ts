/** A Ren'Py save file is a small zip: the same reading as server/src/saves/savefile.ts, in the browser. */

export interface SaveMeta {
  name: string
  ctime?: number
  renpyVersion?: string
  gameVersion?: string
  runtime?: number
  hasScreenshot: boolean
  screenshot?: Uint8Array<ArrayBuffer>
}

/** What the server's reader of a save takes (server/src/util/zip.ts, SAVE_FILE in saves/savefile.ts): entries, and bytes in one and in all. */
const LIMITS = { files: 2048, fileBytes: 64 << 20, totalBytes: 64 << 20 }

interface Entry { method: number; size: number; packed: number; start: number }

class Hostile extends Error {}

/** The server's cleanRelPath: a path that stays inside its folder, written one way only. */
function cleanName(raw: string): string {
  const path = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '')
  if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.includes('\0') || path.length > 1024 || path.split('/').some((s) => !s || s === '.' || s === '..')) throw new Hostile('Invalid path')
  return path
}

/**
 * The files of a zip, after the whole directory is checked: where it is, how many entries, their paths (none twice,
 * none leaving the folder), kinds and methods, where their data is, and the sizes they declare (each and all).
 * Nothing is extracted before every entry passes.
 */
function entries(data: ArrayBuffer): Map<string, Entry> {
  const v = new DataView(data)
  const length = data.byteLength
  const inside = (at: number, size: number) => at >= 0 && size >= 0 && at + size <= length
  let eocd = -1
  for (let i = length - 22; i >= Math.max(0, length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Hostile('No directory')
  const count = v.getUint16(eocd + 10, true)
  const directory = v.getUint32(eocd + 16, true)
  if (count > LIMITS.files) throw new Hostile('Too many entries')
  const out = new Map<string, Entry>(), names = new Set<string>()
  const text = new TextDecoder('utf-8', { fatal: true })
  let p = directory, total = 0
  for (let n = 0; n < count; n++) {
    if (!inside(p, 46) || p + 46 > eocd || v.getUint32(p, true) !== 0x02014b50) throw new Hostile('Broken directory')
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true)
    const packed = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true)
    const attributes = v.getUint32(p + 38, true), offset = v.getUint32(p + 42, true)
    if (!inside(p + 46, nameLen + extraLen + commentLen) || p + 46 + nameLen + extraLen + commentLen > eocd) throw new Hostile('Broken directory')
    const raw = text.decode(new Uint8Array(data, p + 46, nameLen))
    p += 46 + nameLen + extraLen + commentLen
    const name = cleanName(raw)
    const kind = (attributes >>> 16) & 0xf000
    if (kind && kind !== 0x8000 && kind !== 0x4000) throw new Hostile('Links and special files')
    if (names.has(name)) throw new Hostile('Duplicate path')
    names.add(name)
    if (flags & 1 || (method !== 0 && method !== 8)) throw new Hostile('Unsupported entry')
    if (size === 0xffffffff || packed === 0xffffffff || offset === 0xffffffff) throw new Hostile('Zip64')
    total += size
    if (size > LIMITS.fileBytes || total > LIMITS.totalBytes) throw new Hostile('Too large')
    if (method === 0 && packed !== size) throw new Hostile('Sizes differ')
    if (!inside(offset, 30) || v.getUint32(offset, true) !== 0x04034b50) throw new Hostile('Entry outside the archive')
    const start = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true)
    if (!inside(start, packed) || start + packed > directory) throw new Hostile('Entry outside the archive')
    if (!raw.endsWith('/')) out.set(name, { method, size, packed, start })
  }
  return out
}

/** One entry's bytes: exactly as many as the directory declared, counted as they come, and cancelled at the first byte over. */
async function extract(data: ArrayBuffer, e: Entry): Promise<Uint8Array<ArrayBuffer>> {
  const raw = new Uint8Array(data, e.start, e.packed)
  if (e.method === 0) return raw.slice()
  // Blob.stream() fails in a WebKit service worker (NotFoundError), a stream of our own does not.
  const source = new ReadableStream<BufferSource>({ start(c) { c.enqueue(raw); c.close() } })
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const out = new Uint8Array(e.size)
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (n + value.byteLength > e.size) {
      await reader.cancel().catch(() => {})
      throw new Hostile('More bytes than declared')
    }
    out.set(value, n)
    n += value.byteLength
  }
  if (n !== e.size) throw new Hostile('Fewer bytes than declared')
  return out
}

export async function readSave(data: ArrayBuffer, screenshot = false): Promise<SaveMeta | null> {
  try {
    const all = entries(data)
    if (!all.has('log')) return null
    const text = async (name: string) => (all.has(name) ? new TextDecoder().decode(await extract(data, all.get(name)!)) : undefined)
    let json: Record<string, unknown> = {}
    const jsonText = (await text('json')) || '{}'
    try { json = JSON.parse(jsonText) } catch {}
    const renpy = json['_renpy_version']
    return {
      name: (typeof json['_save_name'] === 'string' ? json['_save_name'] : await text('extra_info')) || '',
      ctime: typeof json['_ctime'] === 'number' ? json['_ctime'] : undefined,
      renpyVersion: (Array.isArray(renpy) ? (renpy as number[]).join('.') : undefined) ?? (await text('renpy_version')),
      gameVersion: typeof json['_version'] === 'string' ? json['_version'] : undefined,
      runtime: typeof json['_game_runtime'] === 'number' ? json['_game_runtime'] : undefined,
      hasScreenshot: all.has('screenshot.png'),
      ...(screenshot && all.has('screenshot.png') ? { screenshot: await extract(data, all.get('screenshot.png')!) } : {}),
    }
  } catch {
    return null
  }
}
