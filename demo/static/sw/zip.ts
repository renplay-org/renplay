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

interface Entry { method: number; size: number; offset: number }

function entries(data: ArrayBuffer): Map<string, Entry> | null {
  const v = new DataView(data)
  let eocd = -1
  for (let i = data.byteLength - 22; i >= Math.max(0, data.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return null
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out = new Map<string, Entry>()
  const text = new TextDecoder()
  for (let n = 0; n < count && v.getUint32(p, true) === 0x02014b50; n++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true)
    const offset = v.getUint32(p + 42, true)
    out.set(text.decode(new Uint8Array(data, p + 46, nameLen)), { method, size, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function extract(data: ArrayBuffer, e: Entry): Promise<Uint8Array<ArrayBuffer>> {
  const v = new DataView(data)
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true)
  const raw = new Uint8Array(data, start, e.size)
  if (e.method === 0) return raw.slice()
  // Blob.stream() fails in a WebKit service worker (NotFoundError), a stream of our own does not.
  const source = new ReadableStream<BufferSource>({ start(c) { c.enqueue(raw); c.close() } })
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function readSave(data: ArrayBuffer, screenshot = false): Promise<SaveMeta | null> {
  try {
    const all = entries(data)
    if (!all || !all.has('log')) return null
    const text = async (name: string) => (all.has(name) ? new TextDecoder().decode(await extract(data, all.get(name)!)) : undefined)
    let json: Record<string, unknown> = {}
    try { json = JSON.parse((await text('json')) || '{}') } catch {}
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
