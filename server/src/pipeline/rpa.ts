import { inflateSync } from 'node:zlib'
import { Readable } from 'node:stream'
import { PyObject, unpickle } from '../util/pickle.js'
import { cleanRelPath } from '../util/paths.js'
import { readAll, type SourceEntry } from './archive.js'

const MAX_RPA_INDEX_BYTES = 32 << 20
const MAX_RPA_INDEX_RAW_BYTES = 64 << 20

export interface RpaHeader {
  version: 'RPA-3.0' | 'RPA-2.0'
  indexOffset: number
  key: number
  headerLength: number
}

export interface RpaFile {
  name: string
  segments: Array<{ offset: number; length: number; prefix: Uint8Array }>
}

export function parseRpaHeader(first: Buffer): RpaHeader | null {
  const nl = first.indexOf(0x0a)
  const line = first.subarray(0, nl === -1 ? Math.min(first.length, 64) : nl).toString('latin1')
  if (line.startsWith('RPA-3.0 ')) {
    const offset = parseInt(line.slice(8, 24), 16)
    const key = parseInt(line.slice(25, 33), 16)
    if (!Number.isFinite(offset) || !Number.isFinite(key)) return null
    return { version: 'RPA-3.0', indexOffset: offset, key, headerLength: nl + 1 }
  }
  if (line.startsWith('RPA-2.0 ')) {
    const offset = parseInt(line.slice(8, 24), 16)
    if (!Number.isFinite(offset)) return null
    return { version: 'RPA-2.0', indexOffset: offset, key: 0, headerLength: nl + 1 }
  }
  return null
}

/** XOR for values that can exceed 32 bits; the key itself is 32-bit. */
function xor32(v: number, key: number): number {
  if (!key) return v
  const high = Math.floor(v / 0x100000000)
  const low = v >>> 0
  return high * 0x100000000 + ((low ^ key) >>> 0)
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'boolean') return v ? 1 : 0
  throw new Error('Bad RPA index value')
}

function toBytes(v: unknown): Uint8Array {
  if (v == null) return new Uint8Array()
  if (v instanceof Uint8Array) return v
  if (typeof v === 'string') return Uint8Array.from(v, (c) => c.charCodeAt(0) & 0xff)
  return new Uint8Array()
}

export function parseRpaIndex(compressed: Buffer, header: RpaHeader): RpaFile[] {
  const raw = inflateSync(compressed, { maxOutputLength: MAX_RPA_INDEX_RAW_BYTES })
  const index = unpickle(raw)
  if (!(index instanceof Map)) throw new Error('RPA index is not a dict')
  const out: RpaFile[] = []
  for (const [k, v] of index) {
    let name: string
    try {
      name = cleanRelPath(k instanceof Uint8Array ? new TextDecoder().decode(k) : String(k))
    } catch {
      continue
    }
    if (!Array.isArray(v)) continue
    const segments = v.map((t) => {
      if (!Array.isArray(t) || t instanceof PyObject) throw new Error('Bad RPA index entry')
      return {
        offset: xor32(toNum(t[0]), header.key),
        length: xor32(toNum(t[1]), header.key),
        prefix: toBytes(t[2]),
      }
    })
    out.push({ name, segments })
  }
  return out
}

/** Reads the archive index, using a ranged read when the entry is seekable. */
export async function readRpaIndex(entry: SourceEntry): Promise<{ header: RpaHeader; files: RpaFile[] } | null> {
  const headStream = await entry.open(entry.seekable ? { start: 0, end: Math.min(entry.size, 64) } : undefined)
  let first = Buffer.alloc(0)
  for await (const c of headStream) {
    first = Buffer.concat([first, c as Buffer])
    if (first.length >= 64) break
  }
  headStream.destroy()
  const header = parseRpaHeader(first)
  if (!header || header.indexOffset >= entry.size) return null
  if (entry.size - header.indexOffset > MAX_RPA_INDEX_BYTES) throw new Error('RPA index too large')

  let compressed: Buffer
  if (entry.seekable) {
    compressed = await readAll(await entry.open({ start: header.indexOffset, end: entry.size }), MAX_RPA_INDEX_BYTES)
  } else {
    compressed = await readTail(await entry.open(), header.indexOffset)
  }
  return { header, files: parseRpaIndex(compressed, header) }
}

async function readTail(s: Readable, from: number): Promise<Buffer> {
  let pos = 0
  let size = 0
  const chunks: Buffer[] = []
  for await (const c of s) {
    const buf = c as Buffer
    const end = pos + buf.length
    if (end > from) {
      const tail = pos >= from ? buf : buf.subarray(from - pos)
      size += tail.length
      if (size > MAX_RPA_INDEX_BYTES) throw new Error('RPA index too large')
      chunks.push(tail)
    }
    pos = end
  }
  return Buffer.concat(chunks)
}

export interface RpaSink {
  write(chunk: Buffer): void | Promise<void>
  end(): Promise<void>
}

export interface SplitOptions {
  /** Return null to skip a file. Called in archive order; awaiting applies backpressure. */
  open(name: string, size: number, rangeKey: string): Promise<RpaSink | null>
  /** Called for files that could not be streamed in order (shared or overlapping ranges). */
  deferred?(file: RpaFile): Promise<void>
  signal?: AbortSignal
  onProgress?(bytes: number): void
}

/**
 * Splits an RPA archive into its files in a single sequential pass. Works on
 * deflated zip entries, so the archive never has to exist on disk unpacked.
 */
export async function splitRpa(entry: SourceEntry, files: RpaFile[], opts: SplitOptions): Promise<void> {
  type Target = { file: RpaFile; offset: number; length: number; prefix: Uint8Array }
  const targets: Target[] = []
  const deferred: RpaFile[] = []
  for (const f of files) {
    if (f.segments.length === 1) {
      const s = f.segments[0]!
      targets.push({ file: f, offset: s.offset, length: s.length, prefix: s.prefix })
    } else if (f.segments.length > 1) deferred.push(f)
  }
  targets.sort((a, b) => a.offset - b.offset || a.length - b.length)

  const stream = await entry.open()
  let pos = 0
  let ti = 0
  let cur: { t: Target; got: number; sink: RpaSink | null } | null = null
  const finish = async () => {
    if (cur?.sink) await cur.sink.end()
    cur = null
  }
  const begin = async (t: Target) => {
    const sink = await opts.open(t.file.name, t.prefix.length + t.length, rangeKey(t.offset, t.length, t.prefix))
    if (sink && t.prefix.length) await sink.write(Buffer.from(t.prefix))
    cur = { t, got: 0, sink }
  }

  try {
    for await (const c of stream) {
      if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('aborted')
      const chunk = c as Buffer
      let cp = 0
      while (cp < chunk.length) {
        if (!cur) {
          while (ti < targets.length && targets[ti]!.offset < pos + cp) deferred.push(targets[ti++]!.file)
          if (ti >= targets.length) {
            cp = chunk.length
            break
          }
          const t = targets[ti]!
          if (t.offset >= pos + chunk.length) {
            cp = chunk.length
            break
          }
          cp = t.offset - pos
          ti++
          await begin(t)
          if (t.length === 0) {
            await finish()
            continue
          }
        }
        const active = cur!
        const take = Math.min(active.t.length - active.got, chunk.length - cp)
        if (active.sink) await active.sink.write(chunk.subarray(cp, cp + take))
        active.got += take
        cp += take
        if (active.got === active.t.length) await finish()
      }
      pos += chunk.length
      opts.onProgress?.(pos)
    }
    if (cur) throw new Error(`RPA ended inside ${(cur as { t: Target }).t.file.name}`)
    while (ti < targets.length) deferred.push(targets[ti++]!.file)
  } finally {
    stream.destroy()
  }

  if (deferred.length && opts.deferred) for (const f of deferred) await opts.deferred(f)
}

export function rangeKey(offset: number, length: number, prefix: Uint8Array): string {
  return `${offset}:${length}:${Buffer.from(prefix).toString('hex')}`
}

/** Streams shared, overlapping or multi-segment entries without retaining their contents. */
export function streamRpaFile(entry: SourceEntry, file: RpaFile): Readable {
  return Readable.from((async function* () {
    for (const seg of file.segments) {
      if (seg.prefix.length) yield Buffer.from(seg.prefix)
      if (!seg.length) continue
      const stream = await entry.open(entry.seekable ? { start: seg.offset, end: seg.offset + seg.length } : undefined)
      let skip = entry.seekable ? 0 : seg.offset
      let remaining = seg.length
      try {
        for await (const c of stream) {
          const chunk = c as Buffer
          const from = Math.min(skip, chunk.length)
          skip -= from
          const take = Math.min(chunk.length - from, remaining)
          if (take) {
            yield chunk.subarray(from, from + take)
            remaining -= take
          }
          if (!remaining) break
        }
        if (remaining) throw new Error(`RPA ended inside ${file.name}`)
      } finally {
        stream.destroy()
      }
    }
  })(), { objectMode: false, highWaterMark: 64 << 10 })
}
