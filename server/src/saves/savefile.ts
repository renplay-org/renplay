import yauzl from 'yauzl'
import { HttpError, cleanRelPath } from '../util/paths.js'

export const ZIP_MAX_ENTRIES = 2048
export const ZIP_MAX_ENTRY_BYTES = 64 << 20
export const ZIP_MAX_TOTAL_BYTES = 128 << 20

export interface SaveMeta {
  /** Name given by the player (extra_info). */
  name: string
  /** Seconds since epoch when the save was created (_ctime). */
  ctime?: number
  renpyVersion?: string
  gameVersion?: string
  runtime?: number
  hasScreenshot: boolean
  json: Record<string, unknown>
}

export function isZip(data: Buffer): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
}

export function readZipEntries(data: Buffer | string, want: (name: string) => boolean, limit = 64 << 20, times?: Map<string, number>): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const opened = (err: Error | null, zip?: yauzl.ZipFile) => {
      if (err || !zip) return reject(new HttpError(400, err?.message ?? 'Invalid zip'))
      let failed = false, total = 0, count = 0
      const entries: yauzl.Entry[] = [], names = new Set<string>()
      const fail = (error: Error) => {
        if (failed) return
        failed = true
        zip.close()
        reject(error instanceof HttpError ? error : new HttpError(400, error.message))
      }
      zip.on('error', fail)
      if (zip.entryCount > ZIP_MAX_ENTRIES) return fail(new HttpError(413, 'Too many zip entries'))
      // Validate the entire directory before opening even the first content stream.
      zip.on('entry', (e: yauzl.Entry) => {
        try {
          if (++count > ZIP_MAX_ENTRIES) throw new HttpError(413, 'Too many zip entries')
          const path = cleanRelPath(e.fileName)
          const type = (e.externalFileAttributes >>> 16) & 0xf000
          if (type && type !== 0x8000 && type !== 0x4000) throw new HttpError(400, 'Zip links and special files are not allowed')
          if (names.has(path)) throw new HttpError(400, 'Duplicate zip path')
          names.add(path)
          total += e.uncompressedSize
          if (e.uncompressedSize > ZIP_MAX_ENTRY_BYTES || total > Math.min(limit, ZIP_MAX_TOTAL_BYTES)) throw new HttpError(413, 'Zip contents too large')
          if (!e.fileName.endsWith('/') && want(e.fileName)) entries.push(e)
          zip.readEntry()
        } catch (error) { fail(error as Error) }
      })
      zip.on('end', () => {
        const out = new Map<string, Buffer>()
        const next = (i: number) => {
          if (failed) return
          if (i === entries.length) { zip.close(); resolve(out); return }
          const entry = entries[i]!
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) return fail(error ?? new Error('Invalid zip stream'))
            const chunks: Buffer[] = []
            let bytes = 0
            stream.on('data', (chunk: Buffer) => {
              bytes += chunk.length
              if (bytes > entry.uncompressedSize || bytes > ZIP_MAX_ENTRY_BYTES) { stream.destroy(); fail(new HttpError(413, 'Zip entry too large')) }
              else chunks.push(chunk)
            })
            stream.on('error', fail)
            stream.on('end', () => {
              out.set(entry.fileName, Buffer.concat(chunks))
              times?.set(entry.fileName, entry.getLastModDate().getTime())
              next(i + 1)
            })
          })
        }
        next(0)
      })
      zip.readEntry()
    }
    const options = { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, autoClose: false, strictFileNames: true }
    if (typeof data === 'string') yauzl.open(data, options, opened)
    else yauzl.fromBuffer(data, options, opened)
  })
}

/** True when `data` looks like a Ren'Py save (a zip containing a pickled `log`). */
export async function isRenpySave(data: Buffer): Promise<boolean> {
  if (!isZip(data)) return false
  try {
    const names = new Set<string>()
    await readZipEntries(data, (n) => {
      names.add(n)
      return false
    })
    return names.has('log')
  } catch {
    return false
  }
}

export async function readSaveMeta(data: Buffer): Promise<SaveMeta | null> {
  if (!isZip(data)) return null
  try {
    const names: string[] = []
    const entries = await readZipEntries(data, (n) => {
      names.push(n)
      return n === 'json' || n === 'extra_info' || n === 'renpy_version'
    })
    if (!names.includes('log')) return null
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(entries.get('json')?.toString('utf-8') || '{}')
    } catch {}
    const name = (typeof json['_save_name'] === 'string' ? json['_save_name'] : entries.get('extra_info')?.toString('utf-8')) || ''
    return {
      name,
      ctime: typeof json['_ctime'] === 'number' ? json['_ctime'] : undefined,
      renpyVersion:
        (typeof json['_renpy_version'] === 'object' && Array.isArray(json['_renpy_version'])
          ? (json['_renpy_version'] as number[]).join('.')
          : undefined) ?? entries.get('renpy_version')?.toString('utf-8'),
      gameVersion: typeof json['_version'] === 'string' ? json['_version'] : undefined,
      runtime: typeof json['_game_runtime'] === 'number' ? json['_game_runtime'] : undefined,
      hasScreenshot: names.includes('screenshot.png'),
      json,
    }
  } catch {
    return null
  }
}

export async function readSaveScreenshot(data: Buffer): Promise<Buffer | null> {
  try {
    const e = await readZipEntries(data, (n) => n === 'screenshot.png')
    return e.get('screenshot.png') ?? null
  } catch {
    return null
  }
}

export interface SlotInfo {
  kind: 'manual' | 'auto' | 'quick' | 'internal'
  page?: string
  slot?: string
  label: string
}

/** Interprets Ren'Py save file names such as `3-2-LT1.save` or `auto-1-LT1.save`. */
export function slotInfo(file: string): SlotInfo {
  const base = file.replace(/-LT\d+\.save$/, '').replace(/\.save$/, '')
  if (base.startsWith('_')) return { kind: 'internal', label: base }
  const m = base.match(/^(.*)-(\w+)$/)
  if (!m) return { kind: 'manual', label: base }
  const [, page, slot] = m
  if (page === 'auto') return { kind: 'auto', page, slot, label: `Auto ${slot}` }
  if (page === 'quick') return { kind: 'quick', page, slot, label: `Quick ${slot}` }
  return { kind: 'manual', page, slot, label: `Page ${page} · Slot ${slot}` }
}
