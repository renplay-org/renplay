import { createWriteStream } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import type { JobContext } from '../jobs/manager.js'
import type { PackIndex } from './pack.js'
import { classify, type Placeholder, type ProgressiveRule } from './progressive.js'
import { PY2_COMPAT, PY2_COMPAT_PATH } from './py2compat.js'
import { WEB_COMPAT, WEB_COMPAT_PATH } from './webcompat.js'

/** Already-compressed formats are stored; the rest is deflated. */
export const STORED = /\.(png|jpe?g|webp|avif|gif|ogg|opus|mp3|webm|mp4|ogv|zip|rpa|rpyc|rpymc|rpyb|woff2?)$/i

export interface AssembleOptions {
  /** Build folder: game.zip is written here. */
  dir: string
  /** The engine pack's renpy.zip: Ren'Py's Python package and main.py. */
  renpyZip: string
  /** Files for game.zip, as extracted. */
  zipPack: { path: string; index: PackIndex }
  /** Streamed files (already in the build's assets pack). */
  assets: PackIndex
  rules: ProgressiveRule[]
  placeholders: Map<string, Placeholder>
  /** Files (relative to game/) supplied separately; they go into game.zip and never stream. */
  extra?: Map<string, Buffer>
  /** Adds the Python 2 script: games made with Ren'Py 7 and older, or of no known version. */
  python2?: boolean
  ctx: JobContext
}

export interface AssembleResult {
  zipBytes: number
  zipped: number
  streamed: { files: number; bytes: number }
}

/**
 * Writes game.zip the way Ren'Py's launcher web_build does, without the SDK
 * (so without running the game's code): the engine's Python package, the
 * non-streamed game files, folders and placeholders of streamed files, and
 * game/renpyweb_remote_files.txt listing what streams.
 */
export async function assemble(o: AssembleOptions): Promise<AssembleResult> {
  const extra = o.extra ?? new Map<string, Buffer>()
  const remote: Array<[string, string]> = []
  let streamedBytes = 0
  for (const [rel, [, size]] of [...o.assets].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (extra.has(rel)) continue
    const kind = classify(rel, o.rules)
    if (kind === 'image') {
      const ph = o.placeholders.get(rel)
      if (!ph) continue
      remote.push([rel, `image ${ph.width},${ph.height}`])
    } else if (kind) remote.push([rel, `${kind} -`])
    else continue
    streamedBytes += size
  }

  const zip = new yazl.ZipFile()
  const zipPath = join(o.dir, 'game.zip')
  const written = pipeline(zip.outputStream, createWriteStream(zipPath))

  // 1. Ren'Py's Python package (renpy/**, main.py), shared by all games of an engine.
  await copyZipEntries(o.renpyZip, zip)

  // 2. Folders of streamed files. The engine writes downloads into them and
  //    does not create missing ones, so they must exist after unpacking.
  const dirs = new Set<string>()
  for (const [rel] of remote) {
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  for (const d of [...dirs].sort()) zip.addEmptyDirectory(`game/${d}/`)

  // 3. Game files that do not stream, read lazily from the pack.
  let zipped = 0
  for (const [rel, [offset, size]] of [...o.zipPack.index].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (extra.has(rel)) continue
    zip.addReadStream(new RangeStream(o.zipPack.path, offset, offset + size), `game/${rel}`, { compress: !STORED.test(rel), size })
    zipped++
  }
  for (const [rel, data] of extra) {
    zip.addBuffer(data, `game/${rel}`, { compress: !STORED.test(rel) })
    zipped++
  }
  for (const [path, text] of [...(o.python2 ? [[PY2_COMPAT_PATH, PY2_COMPAT] as const] : []), [WEB_COMPAT_PATH, WEB_COMPAT] as const]) {
    if (!o.zipPack.index.has(path) && !extra.has(path)) zip.addBuffer(Buffer.from(text, 'utf-8'), `game/${path}`)
  }

  // 4. Placeholders of streamed images and the list of streamed files.
  for (const [rel, t] of remote) if (t.startsWith('image')) zip.addBuffer(o.placeholders.get(rel)!.data, `_placeholders/${rel}`, { compress: false })
  zip.addBuffer(Buffer.from(remote.map(([rel, t]) => `${rel}\n${t}\n`).join(''), 'utf-8'), 'game/renpyweb_remote_files.txt')
  zip.end()
  o.ctx.progress('Packing game.zip', 0.5)
  await written

  return { zipBytes: (await stat(zipPath)).size, zipped, streamed: { files: remote.length, bytes: streamedBytes } }
}

/** Reads bytes [start, end) of a file, opening it only when first read. */
export class RangeStream extends Readable {
  private fh: FileHandle | null = null
  private pos: number

  constructor(
    private readonly path: string,
    start: number,
    private readonly end: number,
  ) {
    super({ highWaterMark: 256 << 10 })
    this.pos = start
  }

  override async _read(size: number): Promise<void> {
    try {
      this.fh ??= await open(this.path, 'r')
      const n = Math.min(Math.max(size, 64 << 10), this.end - this.pos)
      if (n <= 0) {
        await this.fh.close()
        this.fh = null
        this.push(null)
        return
      }
      const buf = Buffer.allocUnsafe(n)
      const { bytesRead } = await this.fh.read(buf, 0, n, this.pos)
      if (!bytesRead) throw new Error('Unexpected end of pack')
      this.pos += bytesRead
      this.push(bytesRead === n ? buf : buf.subarray(0, bytesRead))
    } catch (e) {
      this.destroy(e as Error)
    }
  }

  override _destroy(err: Error | null, cb: (e?: Error | null) => void): void {
    const fh = this.fh
    this.fh = null
    if (fh) fh.close().then(() => cb(err), () => cb(err))
    else cb(err)
  }
}

/** Copies every entry of a zip (folders too) into a yazl zip, keeping names and compression. */
export async function copyZipEntries(path: string, into: yazl.ZipFile, skip?: (name: string) => boolean): Promise<Set<string>> {
  const names = new Set<string>()
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (e, z) => (e || !z ? reject(e) : resolve(z))),
  )
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject)
      zip.on('end', () => resolve())
      zip.on('entry', (e: yauzl.Entry) => {
        if (skip?.(e.fileName)) return zip.readEntry()
        if (e.fileName.endsWith('/')) {
          into.addEmptyDirectory(e.fileName, { mtime: e.getLastModDate() })
          names.add(e.fileName)
          return zip.readEntry()
        }
        zip.openReadStream(e, async (err, s) => {
          if (err || !s) return reject(err)
          try {
            // Advance only when the output consumed this entry. Even a zip with
            // thousands of small entries must not queue all their bodies in RAM.
            s.once('error', reject)
            s.once('end', () => zip.readEntry())
            into.addReadStream(s, e.fileName, { compress: e.compressionMethod !== 0, size: e.uncompressedSize, mtime: e.getLastModDate() })
            names.add(e.fileName)
          } catch (er) {
            reject(er)
          }
        })
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
  return names
}
