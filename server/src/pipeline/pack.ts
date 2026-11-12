import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { writeFileAtomic } from '../util/fsx.js'

/** Path -> [offset, length] inside a pack file. */
export type PackIndex = Map<string, [number, number]>

/**
 * An append-only file of concatenated files plus an index. Builds keep their
 * streamed assets in one pack instead of tens of thousands of small files:
 * on NFS every file create is a synchronous round trip (100+ ms on a busy
 * NAS), while appending to one file runs at disk speed, and deleting a build
 * is a handful of unlinks.
 */
export class PackWriter {
  private ws: WriteStream
  private offset = 0
  private lock: Promise<void> = Promise.resolve()
  readonly index: PackIndex = new Map()
  private failed: Error | null = null

  constructor(readonly path: string) {
    this.ws = createWriteStream(path)
    this.ws.on('error', (e) => (this.failed = e))
  }

  get bytes(): number {
    return this.offset
  }

  has(name: string): boolean {
    return this.index.has(name)
  }

  /** Runs `fn` with exclusive access to the end of the pack. */
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.lock
    let release!: () => void
    this.lock = new Promise<void>((r) => (release = r))
    await prev
    try {
      if (this.failed) throw this.failed
      return await fn()
    } finally {
      release()
    }
  }

  private async write(chunk: Buffer): Promise<void> {
    if (!this.ws.write(chunk)) await new Promise<void>((r, j) => {
      const onErr = (e: Error) => j(e)
      this.ws.once('error', onErr)
      this.ws.once('drain', () => {
        this.ws.off('error', onErr)
        r()
      })
    })
    this.offset += chunk.length
  }

  async add(name: string, data: Buffer): Promise<void> {
    await this.exclusive(async () => {
      const start = this.offset
      await this.write(data)
      this.index.set(name, [start, data.length])
    })
  }

  /**
   * Starts a file written in chunks (large files from an archive stream). The
   * pack stays locked until `end()`, so other writers wait.
   */
  async begin(name: string): Promise<{ write(c: Buffer): Promise<void>; end(): Promise<void> }> {
    const prev = this.lock
    let release!: () => void
    this.lock = new Promise<void>((r) => (release = r))
    await prev
    if (this.failed) {
      release()
      throw this.failed
    }
    const start = this.offset
    return {
      write: (c) => this.write(c),
      end: async () => {
        this.index.set(name, [start, this.offset - start])
        release()
      },
    }
  }

  /** Another name for an existing entry (identical data, stored once). */
  alias(name: string, existing: string): boolean {
    const e = this.index.get(existing)
    if (!e) return false
    this.index.set(name, e)
    return true
  }

  private closing: Promise<PackIndex> | null = null

  /** Flushes and closes the pack; later calls wait for the same close. */
  close(): Promise<PackIndex> {
    this.closing ??= (async () => {
      await this.lock
      await new Promise<void>((resolve, reject) => {
        this.ws.once('error', reject)
        this.ws.end(() => resolve())
      })
      if (this.failed) throw this.failed
      return this.index
    })()
    return this.closing
  }
}

export async function writeIndex(path: string, index: PackIndex): Promise<void> {
  const obj: Record<string, [number, number]> = {}
  for (const [k, v] of [...index].sort((a, b) => a[0].localeCompare(b[0]))) obj[k] = v
  await writeFileAtomic(path, JSON.stringify(obj))
}

async function readIndex(path: string): Promise<PackIndex> {
  const obj = JSON.parse(await readFile(path, 'utf-8')) as Record<string, [number, number]>
  return new Map(Object.entries(obj))
}

/** Reads entries of a pack. Indexes are cached (a few builds at a time). */
export class PackReader {
  private static cache = new Map<string, { mtimeMs: number; index: PackIndex }>()
  private static lower = new WeakMap<PackIndex, PackIndex>()

  constructor(
    readonly packPath: string,
    readonly indexPath: string,
  ) {}

  async index(): Promise<PackIndex> {
    const st = await stat(this.indexPath)
    const hit = PackReader.cache.get(this.indexPath)
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.index
    const index = await readIndex(this.indexPath)
    PackReader.cache.set(this.indexPath, { mtimeMs: st.mtimeMs, index })
    while (PackReader.cache.size > 6) PackReader.cache.delete(PackReader.cache.keys().next().value!)
    return index
  }

  /**
   * An entry by its name, or by the name in another case: games made on Windows ask for
   * data/Items.json when the file is data/items.json, which Windows does not tell apart.
   */
  async entry(name: string): Promise<[number, number] | null> {
    const index = await this.index()
    const exact = index.get(name)
    if (exact) return exact
    let lower = PackReader.lower.get(index)
    if (!lower) {
      lower = new Map()
      for (const [k, v] of index) if (!lower.has(k.toLowerCase())) lower.set(k.toLowerCase(), v)
      PackReader.lower.set(index, lower)
    }
    return lower.get(name.toLowerCase()) ?? null
  }

  /** A stream of an entry, or of bytes [from, to] (inclusive) within it. */
  stream(entry: [number, number], from = 0, to = entry[1] - 1): Readable {
    return createReadStream(this.packPath, { start: entry[0] + from, end: entry[0] + to, highWaterMark: 256 << 10 })
  }

  async read(name: string): Promise<Buffer | null> {
    const e = await this.entry(name)
    if (!e) return null
    if (!e[1]) return Buffer.alloc(0)
    const chunks: Buffer[] = []
    for await (const c of this.stream(e)) chunks.push(c as Buffer)
    return Buffer.concat(chunks)
  }
}
