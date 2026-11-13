import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { JobContext } from '../jobs/manager.js'
import { Limiter } from '../util/limit.js'
import { readAll, type ArchiveSource, type SourceEntry } from './archive.js'
import { nameVersionFromSource, pythonOf, renpyVersionFromVc, saveDirFromRpyc, saveDirFromSource, vcNeedsInit, type GameMeta } from './detect.js'
import { MAX_IMAGE_BYTES } from './image-memory.js'
import { ImageProcessor, isOptimizableImage, type ImagePolicy } from './optimize.js'
import type { PackWriter } from './pack.js'
import { classify, streamsImage, type Placeholder, type ProgressiveRule } from './progressive.js'
import { rangeKey, streamRpaFile, readRpaIndex, splitRpa, type RpaSink } from './rpa.js'

export type Layout = { kind: 'project'; root: string } | { kind: 'web'; root: string }

const SCRIPT_EXT = /\.(rpa|rpyc|rpy|rpymc|rpym)$/i

/**
 * Finds the Ren'Py project (folder holding game/) or a prebuilt web build inside an archive.
 * A distributed game has Ren'Py's own renpy/ folder beside its game/, a developer's small
 * launcher project does not: such a root wins, and the one with the most scripts (packed
 * .rpa files count) comes next.
 */
export function detectLayout(entries: SourceEntry[]): Layout | null {
  const scores = new Map<string, number>()
  const web = new Map<string, Set<string>>()
  const withEngine = new Set<string>()
  for (const e of entries) {
    if (e.path.includes('__MACOSX/')) continue
    const folders = e.path.split('/')
    folders.pop()
    const ri = folders.indexOf('renpy')
    if (ri !== -1) withEngine.add(folders.slice(0, ri).join('/'))
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
  const candidates = [...scores].filter(([root]) => withEngine.has(root))
  let best: [string, number] | null = null
  for (const [root, n] of candidates.length ? candidates : scores) {
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
  /** Placeholders for streamed images, keyed by path relative to game/. */
  placeholders: Map<string, Placeholder>
}

/** Where extracted files go: streamed files and the rest (for game.zip). */
export interface ExtractTargets {
  assets: PackWriter
  zip: PackWriter
  /** Paths (relative to game/) supplied separately (recipe patches, re-applied mods). */
  skip: Set<string>
}

const SKIP_GAME = [/^cache\//i, /^saves\//i, /\.rpyb$/i, /(^|\/)\.ds_store$/i, /(^|\/)thumbs\.db$/i, /\.bak$/i]
const KEEP_ROOT = /^(progressive_download\.txt|web-icon\.png)$/i
/**
 * Pictures of the themes and frames Ren'Py 6 kept in its common folder (theme.glow's
 * _theme_glow/g_box.png and the like). Ren'Py 8 dropped them, so a game that uses them gets the
 * ones its own download ships, in its game folder, where Ren'Py looks first.
 */
const OLD_COMMON = /^(?:renpy\/)?common\/(_(?:theme_[^/]+|roundrect|outline|compat|layout)\/[^/]+\.(?:png|jpe?g|gif|webp))$/i

/** A build's presplash picture, by its file name or the end of its path. */
export function isPresplash(path: string): boolean {
  return /(^|\/)web-presplash\.(png|jpe?g|webp)$/i.test(path)
}

/**
 * Extracts the parts of a Ren'Py game a web build needs. Files under game/
 * (RPA archives split on the fly) go into the assets pack when they stream
 * and into the zip pack otherwise; a few root files (web presplash, the
 * developer's progressive_download.txt) are written to `dest`.
 */
export async function extractProject(
  src: ArchiveSource,
  root: string,
  dest: string,
  policy: ImagePolicy,
  concurrency: number,
  ctx: JobContext,
  rules: ProgressiveRule[],
  targets: ExtractTargets,
  isExcluded: (rel: string) => boolean = () => false,
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
  const written = new Set<string>()
  /** RPA byte range -> [pack, name], to store shared entries once. */
  const ranges = new Map<string, ['assets' | 'zip', string]>()
  const limiter = new Limiter(concurrency)
  const images = new ImageProcessor()
  const placeholders = new Map<string, Placeholder>()
  const packs = { assets: targets.assets, zip: targets.zip }
  await mkdir(dest, { recursive: true })

  const inRoot = src.entries.filter((e) => e.path.startsWith(root) && !e.path.includes('__MACOSX/'))
  const gameEntries: Array<{ rel: string; e: SourceEntry }> = []
  const rpas: Array<{ rel: string; e: SourceEntry }> = []
  const rpycs: Array<{ rel: string; e: SourceEntry }> = []
  const oldCommon: Array<{ rel: string; e: SourceEntry }> = []
  let total = 0
  const skipped = (g: string) => SKIP_GAME.some((r) => r.test(g)) || isExcluded(g) || targets.skip.has(g) || written.has(g.toLowerCase())

  for (const e of inRoot) {
    const rel = e.path.slice(root.length)
    if (rel === 'renpy/vc_version.py') {
      const vc = (await readAll(await e.open(), 1 << 20)).toString('utf-8')
      const init = vcNeedsInit(vc) ? inRoot.find((x) => x.path === `${root}renpy/__init__.py`) : undefined
      meta.renpyVersion = renpyVersionFromVc(vc, init ? (await readAll(await init.open(), 1 << 20)).toString('utf-8') : undefined, pythonOf(inRoot.map((x) => x.path), root))
      continue
    }
    if (!rel.startsWith('game/')) {
      const old = OLD_COMMON.exec(rel)
      if (old) oldCommon.push({ rel: old[1]!, e })
      if (KEEP_ROOT.test(rel) || (!rel.includes('/') && isPresplash(rel))) {
        await pipeline(await e.open(), createWriteStream(join(dest, rel)))
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
    if (SKIP_GAME.some((r) => r.test(g)) || isExcluded(g) || targets.skip.has(g)) continue
    if (/\.rpa$/i.test(g)) {
      rpas.push({ rel: g, e })
      total += e.size
      continue
    }
    if (/\.rpyc$/i.test(g)) rpycs.push({ rel: g, e })
    gameEntries.push({ rel: g, e })
    total += e.size
  }
  // Games made with Ren'Py 7 and later never use the old themes.
  if (Number(meta.renpyVersion?.split('.')[0]) >= 7) oldCommon.length = 0
  for (const x of oldCommon) total += x.e.size

  let done = 0
  let reported = Date.now()
  const tick = (n: number, what: string) => {
    done += n
    ctx.progress('Unpacking game files', total ? done / total : 0, what)
    // Long installs write a progress line now and then, so the log shows they move.
    if (Date.now() - reported > 30_000) {
      reported = Date.now()
      const pct = total ? Math.floor((100 * done) / total) : 0
      ctx.log(`Unpacking: ${pct}% (${(done / 1e9).toFixed(2)} of ${(total / 1e9).toFixed(2)} GB read), ${stats.files.toLocaleString('en-US')} files written, ${stats.imagesConverted.toLocaleString('en-US')} images converted`)
    }
  }

  /** Streamed (non-image) files go to the assets pack; images decide after their placeholder. */
  const packFor = (g: string): 'assets' | 'zip' => {
    const kind = classify(g, rules)
    return kind && kind !== 'image' ? 'assets' : 'zip'
  }

  const put = async (pack: 'assets' | 'zip', g: string, data: Buffer) => {
    await packs[pack].add(g, data)
    stats.bytesOut += data.length
    return pack
  }

  const needsPlaceholder = (g: string) => streamsImage(g, rules)
  const wantsImageTask = (g: string, size: number) =>
    size <= MAX_IMAGE_BYTES && ((policy.enabled && isOptimizableImage(g)) || needsPlaceholder(g))

  const handleImage = async (g: string, data: Buffer, key?: string) => {
    const r = await images.process(data, g, policy, needsPlaceholder(g))
    if (r.changed) {
      stats.imagesConverted++
      stats.imageBytesBefore += data.length
      stats.imageBytesAfter += r.data.length
    }
    let pack: 'assets' | 'zip' = 'zip'
    if (r.placeholder) {
      placeholders.set(g, r.placeholder)
      pack = 'assets'
    }
    await put(pack, g, r.data)
    if (key) ranges.set(key, [pack, g])
  }

  const streamInto = async (g: string, s: Readable, size: number) => {
    const pack = packFor(g)
    const w = await packs[pack].begin(g)
    try {
      for await (const c of s) await w.write(c as Buffer)
    } finally {
      await w.end()
    }
    stats.bytesOut += size
    return pack
  }

  const noteFile = (g: string) => {
    written.add(g.toLowerCase())
    stats.files++
  }

  const writeLoose = async (g: string, e: SourceEntry) => {
    ctx.checkAbort()
    noteFile(g)
    stats.bytesIn += e.size
    if (/\.rpy$/i.test(g) && e.size < 4 << 20) {
      const buf = await readAll(await e.open())
      inspectSource(buf.toString('utf-8'), meta)
      await put(packFor(g), g, buf)
    } else if (wantsImageTask(g, e.size)) {
      // Reserve before reading: queued tasks must not retain another whole image.
      await limiter.acquire()
      try {
        const buf = await readAll(await e.open(), MAX_IMAGE_BYTES)
        limiter.spawn(() => handleImage(g, buf))
      } catch (err) {
        limiter.release()
        throw err
      }
    } else {
      await streamInto(g, await e.open(), e.size)
    }
    tick(e.size, g)
  }

  // Phase A: loose files. They take precedence over archive contents.
  for (const { rel: g, e } of gameEntries) await writeLoose(g, e)

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
      await streamInto(archiveRel, await e.open(), e.size)
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
        // Archive paths are relative to the game directory, wherever the .rpa sits.
        const g = name
        if (skipped(g)) return null
        noteFile(g)
        stats.bytesIn += size
        if (/\.rpy$/i.test(g) && size < 4 << 20)
          return bufferSink(size, async (buf) => {
            inspectSource(buf.toString('utf-8'), meta)
            ranges.set(key, [await put(packFor(g), g, buf), g])
          })
        if (/\.rpyc$/i.test(g) && size < 16 << 20)
          return bufferSink(size, async (buf) => {
            if (!meta.saveDir && /options/i.test(g)) meta.saveDir = saveDirFromRpyc(buf) ?? undefined
            ranges.set(key, [await put(packFor(g), g, buf), g])
          })
        if (wantsImageTask(g, size)) {
          // Waiting for a slot here throttles the archive stream; the encode itself
          // runs in the background so the next file can be read meanwhile.
          await limiter.acquire()
          return bufferSink(size, async (buf) => limiter.spawn(() => handleImage(g, buf, key)))
        }
        const pack = packFor(g)
        const w = await packs[pack].begin(g)
        ranges.set(key, [pack, g])
        return {
          write: (c) => w.write(c),
          end: async () => {
            await w.end()
            stats.bytesOut += size
          },
        }
      },
      deferred: async (file) => {
        // Shared entries point at an earlier output; make sure its encode finished.
        await limiter.drain()
        const g = file.name
        if (skipped(g)) return
        noteFile(g)
        const seg = file.segments.length === 1 ? file.segments[0]! : null
        const same = seg ? ranges.get(rangeKey(seg.offset, seg.length, seg.prefix)) : undefined
        if (same && packs[same[0]].alias(g, same[1])) {
          const ph = placeholders.get(same[1])
          if (ph && needsPlaceholder(g)) placeholders.set(g, ph)
          return
        }
        ctx.log(`Re-reading ${g} from ${archiveRel} (shared or overlapping data)`)
        const size = file.segments.reduce((n, s) => n + s.length + s.prefix.length, 0)
        const stream = streamRpaFile(e, file)
        if (wantsImageTask(g, size)) await handleImage(g, await readAll(stream, MAX_IMAGE_BYTES))
        else await streamInto(g, stream, size)
      },
    })
    tick(e.size - reported, archiveRel)
    stats.archivesSplit++
  }

  // Last, the old common pictures the game has no file of its own for, loose or archived.
  for (const { rel: g, e } of oldCommon) if (!skipped(g)) await writeLoose(g, e)

  await limiter.drain()
  ctx.log(`Prepared ${placeholders.size} streaming placeholders`)

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
  return { meta, stats, placeholders }
}

function inspectSource(src: string, meta: GameMeta): void {
  if (!meta.saveDir) meta.saveDir = saveDirFromSource(src) ?? undefined
  if (!meta.screen) {
    const m = src.match(/\bgui\.init\(\s*(\d{3,5})\s*,\s*(\d{3,5})\s*\)/)
    if (m) meta.screen = [Number(m[1]), Number(m[2])]
  }
  if (!meta.title || !meta.version) {
    const nv = nameVersionFromSource(src)
    meta.title ??= nv.name
    meta.version ??= nv.version
  }
}

function bufferSink(size: number, done: (buf: Buffer) => Promise<void>): RpaSink {
  const data = Buffer.allocUnsafe(size)
  let offset = 0
  return {
    write(c) {
      if (offset + c.length > size) throw new Error('RPA entry exceeds declared size')
      c.copy(data, offset)
      offset += c.length
    },
    end: async () => {
      if (offset !== size) throw new Error('RPA entry ended before declared size')
      await done(data)
    },
  }
}
