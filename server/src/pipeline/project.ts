import { createWriteStream, type WriteStream } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { JobContext } from '../jobs.js'
import { Limiter } from '../util/limit.js'
import { safeJoin } from '../util/paths.js'
import { readAll, type ArchiveSource, type SourceEntry } from './archive.js'
import { nameVersionFromSource, renpyVersionFromVc, saveDirFromRpyc, saveDirFromSource, type GameMeta } from './detect.js'
import { isOptimizableImage, transcodeImage, type ImagePolicy } from './optimize.js'
import { makePlaceholder, streamsImage, type ProgressiveRule } from './progressive.js'
import { rangeKey, readRpaFile, readRpaIndex, splitRpa, type RpaSink } from './rpa.js'

export type Layout = { kind: 'project'; root: string } | { kind: 'web'; root: string }

const SCRIPT_EXT = /\.(rpa|rpyc|rpy|rpymc|rpym)$/i

/** Finds the Ren'Py project (folder holding game/) or a prebuilt web build inside an archive. */
export function detectLayout(entries: SourceEntry[]): Layout | null {
  const scores = new Map<string, number>()
  const web = new Map<string, Set<string>>()
  for (const e of entries) {
    if (e.path.includes('__MACOSX/')) continue
    const idx = e.path.lastIndexOf('game/')
    const parts = e.path.split('/')
    const name = parts[parts.length - 1]!
    if (name === 'index.html' || name === 'game.zip' || name === 'renpy.wasm' || name === 'renpy.js') {
      const root = parts.slice(0, -1).join('/')
      if (!web.has(root)) web.set(root, new Set())
      web.get(root)!.add(name)
    }
    if (idx === -1 || !SCRIPT_EXT.test(e.path)) continue
    // Root is everything before the last "game/" segment that starts a path segment.
    const segs = e.path.split('/')
    const gi = segs.lastIndexOf('game')
    if (gi === -1 || gi === segs.length - 1) continue
    const root = segs.slice(0, gi).join('/')
    scores.set(root, (scores.get(root) ?? 0) + 1)
  }
  for (const [root, names] of web) {
    if (names.has('index.html') && names.has('game.zip') && (names.has('renpy.wasm') || names.has('renpy.js'))) {
      return { kind: 'web', root: root ? root + '/' : '' }
    }
  }
  let best: [string, number] | null = null
  for (const [root, n] of scores) {
    if (!best || n > best[1] || (n === best[1] && root.length < best[0].length)) best = [root, n]
  }
  if (!best) return null
  return { kind: 'project', root: best[0] ? best[0] + '/' : '' }
}

export interface ExtractStats {
  files: number
  bytesIn: number
  bytesOut: number
  imagesConverted: number
  imageBytesBefore: number
  imageBytesAfter: number
  archivesSplit: number
  archivesKept: string[]
}

export interface ExtractResult {
  meta: GameMeta
  stats: ExtractStats
  /** Paths (relative to game/) of the main-menu-like images seen, for covers. */
  coverCandidates: string[]
}

const SKIP_GAME = [/^cache\//i, /^saves\//i, /\.rpyb$/i, /(^|\/)\.ds_store$/i, /(^|\/)thumbs\.db$/i, /\.bak$/i]
const KEEP_ROOT = /^(progressive_download\.txt|web-presplash\.(png|jpe?g|webp)|web-icon\.png)$/i
const COVER_RE = /(^|\/)(main_menu|mainmenu|main_menu_background|menu_bg|title)[^/]*\.(png|jpe?g|webp)$/i

/**
 * Writes the parts of a Ren'Py game that a web build needs into `dest`:
 * game/ (with RPA archives split into loose files) plus web-specific root files.
 */
export async function extractProject(
  src: ArchiveSource,
  root: string,
  dest: string,
  policy: ImagePolicy,
  concurrency: number,
  ctx: JobContext,
  placeholders?: { dir: string; rules: ProgressiveRule[] },
): Promise<ExtractResult> {
  const stats: ExtractStats = {
    files: 0,
    bytesIn: 0,
    bytesOut: 0,
    imagesConverted: 0,
    imageBytesBefore: 0,
    imageBytesAfter: 0,
    archivesSplit: 0,
    archivesKept: [],
  }
  const meta: GameMeta = {}
  const coverCandidates: string[] = []
  const written = new Set<string>()
  const ranges = new Map<string, string>()
  const limiter = new Limiter(concurrency)
  const dims: Record<string, [number, number]> = {}
  const gameDir = join(dest, 'game')
  await mkdir(gameDir, { recursive: true })

  const inRoot = src.entries.filter((e) => e.path.startsWith(root) && !e.path.includes('__MACOSX/'))
  const gameEntries: Array<{ rel: string; e: SourceEntry }> = []
  const rpas: Array<{ rel: string; e: SourceEntry }> = []
  const rpycs: Array<{ rel: string; e: SourceEntry }> = []
  let total = 0

  for (const e of inRoot) {
    const rel = e.path.slice(root.length)
    if (rel === 'renpy/vc_version.py') {
      meta.renpyVersion = renpyVersionFromVc((await readAll(await e.open(), 1 << 20)).toString('utf-8'))
      continue
    }
    if (!rel.startsWith('game/')) {
      if (KEEP_ROOT.test(rel)) {
        await pipeline(await e.open(), createWriteStream(join(dest, rel)))
        if (/^web-presplash/i.test(rel)) coverCandidates.push(`../${rel}`)
      }
      continue
    }
    const g = rel.slice(5)
    if (g === 'cache/build_info.json') {
      try {
        const info = JSON.parse((await readAll(await e.open(), 1 << 20)).toString('utf-8'))
        if (typeof info.name === 'string') meta.title ??= info.name
        if (typeof info.version === 'string') meta.version ??= info.version
      } catch {}
      continue
    }
    if (SKIP_GAME.some((r) => r.test(g))) continue
    if (/\.rpa$/i.test(g)) {
      rpas.push({ rel: g, e })
      total += e.size
      continue
    }
    if (/\.rpyc$/i.test(g)) rpycs.push({ rel: g, e })
    gameEntries.push({ rel: g, e })
    total += e.size
  }

  let done = 0
  const tick = (n: number, what: string) => {
    done += n
    ctx.progress('Unpacking game files', total ? done / total : 0, what)
  }

  const writeBuffer = async (g: string, data: Buffer) => {
    const out = safeJoin(gameDir, g)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, data)
    stats.bytesOut += data.length
  }

  const needsPlaceholder = (g: string) => !!placeholders && streamsImage(`game/${g}`, placeholders.rules)
  const wantsImageTask = (g: string, size: number) =>
    size < 256 << 20 && ((policy.enabled && isOptimizableImage(g)) || needsPlaceholder(g))

  const handleImage = async (g: string, data: Buffer) => {
    const r = await transcodeImage(data, g, policy)
    if (r.changed) {
      stats.imagesConverted++
      stats.imageBytesBefore += data.length
      stats.imageBytesAfter += r.data.length
    }
    await writeBuffer(g, r.data)
    if (placeholders && needsPlaceholder(g)) {
      const ph = await makePlaceholder(r.data)
      if (ph) {
        const out = safeJoin(join(placeholders.dir, 'files'), g)
        await mkdir(dirname(out), { recursive: true })
        await writeFile(out, ph.png)
        dims[g] = [ph.width, ph.height]
      }
    }
  }

  const noteFile = (g: string) => {
    written.add(g.toLowerCase())
    stats.files++
    if (COVER_RE.test(g)) coverCandidates.push(g)
  }

  // Phase A: loose files. They take precedence over archive contents.
  for (const { rel: g, e } of gameEntries) {
    ctx.checkAbort()
    noteFile(g)
    stats.bytesIn += e.size
    if (/\.rpy$/i.test(g) && e.size < 4 << 20) {
      const buf = await readAll(await e.open())
      inspectSource(buf.toString('utf-8'), meta)
      await writeBuffer(g, buf)
      tick(e.size, g)
      continue
    }
    if (wantsImageTask(g, e.size)) {
      const buf = await readAll(await e.open())
      await limiter.run(() => handleImage(g, buf))
      tick(e.size, g)
      continue
    }
    const out = safeJoin(gameDir, g)
    await mkdir(dirname(out), { recursive: true })
    await pipeline(await e.open(), createWriteStream(out))
    stats.bytesOut += e.size
    tick(e.size, g)
  }

  // Phase B: archives, in name order. The first archive holding a name wins.
  rpas.sort((a, b) => a.rel.localeCompare(b.rel))
  for (const { rel: archiveRel, e } of rpas) {
    ctx.checkAbort()
    let index = null
    try {
      index = await readRpaIndex(e)
    } catch (err) {
      ctx.log(`Could not read ${archiveRel}: ${(err as Error).message}`)
    }
    if (!index) {
      ctx.log(`Keeping ${archiveRel} as-is (unknown archive format, it will not stream progressively)`)
      stats.archivesKept.push(archiveRel)
      const out = safeJoin(gameDir, archiveRel)
      await mkdir(dirname(out), { recursive: true })
      await pipeline(await e.open(), createWriteStream(out))
      tick(e.size, archiveRel)
      continue
    }
    ctx.log(`Splitting ${archiveRel}: ${index.files.length} files (${index.header.version})`)
    let reported = 0
    await splitRpa(e, index.files, {
      signal: ctx.signal,
      onProgress: (bytes) => {
        tick(bytes - reported, archiveRel)
        reported = bytes
      },
      open: async (name, size, key) => {
        // Archive paths are relative to the game directory, regardless of where the .rpa sits.
        const g = name
        if (SKIP_GAME.some((r) => r.test(g)) || written.has(g.toLowerCase())) return null
        noteFile(g)
        stats.bytesIn += size
        if (/\.rpy$/i.test(g) && size < 4 << 20) return bufferSink(async (buf) => {
          inspectSource(buf.toString('utf-8'), meta)
          await writeBuffer(g, buf)
          ranges.set(key, g)
        })
        if (/\.rpyc$/i.test(g) && size < 16 << 20) return bufferSink(async (buf) => {
          if (!meta.saveDir && /options/i.test(g)) meta.saveDir = saveDirFromRpyc(buf) ?? undefined
          await writeBuffer(g, buf)
          ranges.set(key, g)
        })
        if (wantsImageTask(g, size)) {
          // Waiting for a slot here throttles the archive stream; the encode itself
          // runs in the background so the next file can be read meanwhile.
          await limiter.acquire()
          ranges.set(key, g)
          return bufferSink(async (buf) => limiter.spawn(() => handleImage(g, buf)))
        }
        ranges.set(key, g)
        return fileSink(safeJoin(gameDir, g), (n) => (stats.bytesOut += n))
      },
      deferred: async (file) => {
        // Shared entries copy an earlier output; make sure its encode finished.
        await limiter.drain()
        const g = file.name
        if (SKIP_GAME.some((r) => r.test(g)) || written.has(g.toLowerCase())) return
        const seg = file.segments.length === 1 ? file.segments[0]! : null
        const same = seg ? ranges.get(rangeKey(seg.offset, seg.length, seg.prefix)) : undefined
        noteFile(g)
        if (same) {
          await mkdir(dirname(safeJoin(gameDir, g)), { recursive: true })
          await copyFile(safeJoin(gameDir, same), safeJoin(gameDir, g))
          return
        }
        ctx.log(`Re-reading ${g} from ${archiveRel} (shared or overlapping data)`)
        await writeBuffer(g, await readRpaFile(e, file))
      },
    })
    tick(e.size - reported, archiveRel)
    stats.archivesSplit++
  }

  await limiter.drain()
  if (placeholders) {
    await mkdir(placeholders.dir, { recursive: true })
    await writeFile(join(placeholders.dir, 'index.json'), JSON.stringify(dims))
    ctx.log(`Prepared ${Object.keys(dims).length} streaming placeholders`)
  }

  // save_directory from compiled scripts if sources were not shipped.
  if (!meta.saveDir) {
    const ordered = [...rpycs].sort((a, b) => Number(!/options/i.test(a.rel)) - Number(!/options/i.test(b.rel)))
    for (const { e } of ordered.slice(0, 400)) {
      if (e.size > 16 << 20) continue
      const sd = saveDirFromRpyc(await readAll(await e.open()))
      if (sd) {
        meta.saveDir = sd
        break
      }
    }
  }
  return { meta, stats, coverCandidates }
}

function inspectSource(src: string, meta: GameMeta): void {
  if (!meta.saveDir) meta.saveDir = saveDirFromSource(src) ?? undefined
  if (!meta.title || !meta.version) {
    const nv = nameVersionFromSource(src)
    meta.title ??= nv.name
    meta.version ??= nv.version
  }
}

function bufferSink(done: (buf: Buffer) => Promise<void>): RpaSink {
  const chunks: Buffer[] = []
  return {
    write(c) {
      chunks.push(Buffer.from(c))
    },
    end: () => done(Buffer.concat(chunks)),
  }
}

function fileSink(path: string, onBytes: (n: number) => void): RpaSink {
  let ws: WriteStream | null = null
  let ready: Promise<void> | null = null
  const open = () => {
    ready ??= mkdir(dirname(path), { recursive: true }).then(() => {
      ws = createWriteStream(path)
    })
    return ready
  }
  return {
    async write(c) {
      await open()
      onBytes(c.length)
      // Copy: the source chunk buffer may be reused by the decompressor.
      if (!ws!.write(Buffer.from(c))) await new Promise<void>((r) => ws!.once('drain', () => r()))
    },
    async end() {
      await open()
      await new Promise<void>((resolve, reject) => {
        ws!.once('error', reject)
        ws!.end(() => resolve())
      })
    },
  }
}

/** Default progressive download rules: GUI and short UI sounds stay in game.zip, everything else streams. */
export const DEFAULT_PROGRESSIVE_RULES = `# Written by renplay. First matching rule wins.
# '+' streams on demand, '-' keeps the file in game.zip.
- image game/gui/**
+ image game/**
- music game/gui/**
- music game/voice/**
+ music game/**
+ voice game/**
`
