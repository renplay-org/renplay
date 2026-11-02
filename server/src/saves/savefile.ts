import yauzl from 'yauzl'

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

export function readZipEntries(data: Buffer, want: (name: string) => boolean, limit = 64 << 20): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('zip'))
      const out = new Map<string, Buffer>()
      let total = 0
      zip.on('entry', (e: yauzl.Entry) => {
        if (e.fileName.endsWith('/') || !want(e.fileName)) return zip.readEntry()
        total += e.uncompressedSize
        if (total > limit) {
          zip.close()
          return reject(new Error('Zip contents too large'))
        }
        zip.openReadStream(e, (er, s) => {
          if (er || !s) return reject(er)
          const chunks: Buffer[] = []
          s.on('data', (c: Buffer) => chunks.push(c))
          s.on('error', reject)
          s.on('end', () => {
            out.set(e.fileName, Buffer.concat(chunks))
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve(out))
      zip.on('error', reject)
      zip.readEntry()
    })
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
