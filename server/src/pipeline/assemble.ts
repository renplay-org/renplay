import { createReadStream, createWriteStream } from 'node:fs'
import { readdir, rmdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import type { JobContext } from '../jobs.js'
import { walkFiles } from '../util/fsx.js'
import { readAll } from './archive.js'
import { classify, type Placeholder, type ProgressiveRule, type StreamKind } from './progressive.js'

/** Already-compressed formats are stored; the rest is deflated. */
const STORED = /\.(png|jpe?g|webp|avif|gif|ogg|opus|mp3|webm|mp4|ogv|zip|rpa|rpyc|rpymc|rpyb|woff2?)$/i

export interface AssembleOptions {
  /** Folder with game/ (and optionally web-presplash.*), as extracted. */
  dir: string
  /** The engine pack's renpy.zip: Ren'Py's Python package and main.py. */
  renpyZip: string
  rules: ProgressiveRule[]
  placeholders: Map<string, Placeholder>
  /** Files (relative to game/) that must go into game.zip even if they would stream. */
  forceZip?: Set<string>
  ctx: JobContext
}

export interface AssembleResult {
  zipBytes: number
  zipped: number
  streamed: { files: number; bytes: number }
  remote: number
}

/**
 * Turns an extracted game into a Ren'Py web build, the way the launcher's
 * web_build does, without running the SDK (and so without running the game's
 * code on the server): streamed files stay in <dir>/game, everything else goes
 * into <dir>/game.zip with the engine's Python package, low-resolution
 * placeholders for streamed images and game/renpyweb_remote_files.txt.
 */
export async function assemble(o: AssembleOptions): Promise<AssembleResult> {
  const gameDir = join(o.dir, 'game')
  const files = (await walkFiles(gameDir)).sort((a, b) => a.rel.localeCompare(b.rel))
  const remote: Array<[string, string]> = []
  const zipFiles: typeof files = []
  let streamedBytes = 0
  for (const f of files) {
    let kind: StreamKind | null = o.forceZip?.has(f.rel) ? null : classify(f.rel, o.rules)
    // An image only streams if it has a placeholder to show meanwhile.
    if (kind === 'image' && !o.placeholders.has(f.rel)) kind = null
    if (!kind) {
      zipFiles.push(f)
      continue
    }
    streamedBytes += f.size
    if (kind === 'image') {
      const ph = o.placeholders.get(f.rel)!
      remote.push([f.rel, `image ${ph.width},${ph.height}`])
    } else remote.push([f.rel, `${kind} -`])
  }

  const zip = new yazl.ZipFile()
  const zipPath = join(o.dir, 'game.zip')
  const written = pipeline(zip.outputStream, createWriteStream(zipPath))

  // 1. Ren'Py's Python package (renpy/**, main.py), shared by all games of an engine.
  await copyZipEntries(o.renpyZip, zip)

  // 2. Game files that do not stream.
  let n = 0
  for (const f of zipFiles) {
    zip.addReadStream(createReadStream(f.full), `game/${f.rel}`, { compress: !STORED.test(f.rel), size: f.size, mtime: new Date(f.mtimeMs) })
    if (++n % 500 === 0) o.ctx.progress('Packing game.zip', n / Math.max(1, zipFiles.length))
  }

  // 3. Folders of streamed files. The engine writes downloads into them and
  //    does not create missing ones, so they must exist after unpacking.
  const dirs = new Set<string>()
  for (const [rel] of remote) {
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  for (const d of [...dirs].sort()) zip.addEmptyDirectory(`game/${d}/`)

  // 4. Placeholders of streamed images and the list of streamed files.
  const streamedImages = new Set(remote.filter(([, t]) => t.startsWith('image')).map(([r]) => r))
  for (const [rel, ph] of o.placeholders) {
    if (streamedImages.has(rel)) zip.addBuffer(ph.data, `_placeholders/${rel}`, { compress: false })
  }
  const list = remote.map(([rel, t]) => `${rel}\n${t}\n`).join('')
  zip.addBuffer(Buffer.from(list, 'utf-8'), 'game/renpyweb_remote_files.txt')
  zip.end()
  await written

  // Files now in game.zip leave the streamed folder.
  for (const f of zipFiles) await unlink(f.full)
  await removeEmptyDirs(gameDir)

  return { zipBytes: (await stat(zipPath)).size, zipped: zipFiles.length, streamed: { files: remote.length, bytes: streamedBytes }, remote: remote.length }
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
            // Buffer small entries; stream big ones (game.zip of a mod base).
            if (e.uncompressedSize < 32 << 20) {
              into.addBuffer(await readAll(s), e.fileName, { compress: e.compressionMethod !== 0, mtime: e.getLastModDate() })
            } else {
              into.addReadStream(s, e.fileName, { compress: e.compressionMethod !== 0, size: e.uncompressedSize, mtime: e.getLastModDate() })
            }
            names.add(e.fileName)
            zip.readEntry()
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

async function removeEmptyDirs(dir: string): Promise<boolean> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  let empty = true
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!(await removeEmptyDirs(join(dir, e.name)))) empty = false
    } else empty = false
  }
  if (empty) await rmdir(dir).catch(() => {})
  return empty
}
