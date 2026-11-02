import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import yazl from 'yazl'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import type { JobContext } from '../jobs.js'
import { MARKER, legacyBuildId, newBuildId, readMarker, writeMarker, type BuildMarker, type Library } from '../library.js'
import type { Overlays } from '../mods.js'
import { dirSize, exists, walkFiles, writeFileAtomic } from '../util/fsx.js'
import { Limiter } from '../util/limit.js'
import { safeJoin } from '../util/paths.js'
import { openZip, readAll } from './archive.js'
import { saveDirFromRpyc, saveDirFromSource } from './detect.js'
import { registerEngine, stripEngine } from './engine.js'
import { saveCover } from './import.js'
import { defaultImagePolicy, imageConcurrency, isOptimizableImage, makeCover, transcodeImage } from './optimize.js'
import type { SdkManager } from './sdk.js'

export interface MaintainDeps {
  cfg: Config
  db: Db
  library: Library
  overlays: Overlays
  sdk: SdkManager
}

/** Reads metadata from an existing web build (legacy or managed) without modifying it. */
export async function analyzeBuild(ctx: JobContext<{ slug: string }>, deps: MaintainDeps): Promise<unknown> {
  const { cfg, db } = deps
  const slug = ctx.params.slug
  const dir = deps.library.gameDir(slug)
  const game = db.getGame(slug)
  if (!game) throw new Error('Game not found')
  ctx.progress('Reading game.zip')
  const zipInfo = await inspectGameZip(join(dir, 'game.zip'))
  ctx.progress('Registering engine')
  const engine = (await exists(join(dir, 'renpy.wasm'))) ? await registerEngine(cfg.enginesDir, dir) : game.engine || null
  ctx.progress('Measuring size')
  const size = await dirSize(dir)
  const updates: Record<string, unknown> = {
    engine: engine ?? '',
    size_bytes: size.bytes,
    file_count: size.files,
    build_id: (await readMarker(dir))?.buildId ?? (await legacyBuildId(dir)),
  }
  if (zipInfo.saveDir && (!game.save_dir || game.save_dir_source === '' || game.save_dir_source === 'detected')) {
    updates.save_dir = zipInfo.saveDir
    updates.save_dir_source = 'detected'
  }
  if (zipInfo.screen && !game.screen_w) {
    updates.screen_w = zipInfo.screen[0]
    updates.screen_h = zipInfo.screen[1]
  }
  if (zipInfo.version && !game.version) updates.version = zipInfo.version
  if (!game.thumbnail) {
    const cover = await coverFromBuild(dir)
    if (cover) updates.thumbnail = await saveCover(cfg, slug, cover)
  }
  db.updateGame(slug, updates)
  ctx.log(`save_dir=${zipInfo.saveDir ?? '?'} screen=${zipInfo.screen?.join('x') ?? '?'} engine=${engine ?? '-'} size=${(size.bytes / 1e9).toFixed(2)} GB`)
  return { ...zipInfo, engine, size: size.bytes }
}

/** Picks main menu art from game.zip (or the presplash) as a library cover. */
async function coverFromBuild(dir: string): Promise<Buffer | null> {
  const candidates: Array<[number, () => Promise<Buffer>]> = []
  if (await exists(join(dir, 'game.zip'))) {
    const src = await openZip(join(dir, 'game.zip'))
    try {
      for (const e of src.entries) {
        if (!/^game\/.*(main_menu|mainmenu|menu_bg|title)[^/]*\.(png|jpe?g|webp)$/i.test(e.path) || e.size > 32 << 20) continue
        const score = (/\/main_menu\.(png|jpe?g|webp)$/i.test(e.path) ? 4e9 : /main_menu/i.test(e.path) ? 2e9 : 0) + e.size
        candidates.push([score, async () => readAll(await e.open())])
      }
      candidates.sort((a, b) => b[0] - a[0])
      for (const [, load] of candidates.slice(0, 3)) {
        try {
          return await makeCover(await load())
        } catch {}
      }
    } finally {
      src.close()
    }
  }
  for (const name of ['web-presplash.jpg', 'web-presplash.png', 'web-presplash.webp']) {
    try {
      return await makeCover(await readFile(join(dir, name)))
    } catch {}
  }
  return null
}

export async function inspectGameZip(path: string): Promise<{ saveDir?: string; screen?: [number, number]; version?: string; title?: string }> {
  const out: { saveDir?: string; screen?: [number, number]; version?: string; title?: string } = {}
  if (!(await exists(path))) return out
  const src = await openZip(path)
  try {
    const byPath = new Map(src.entries.map((e) => [e.path, e]))
    const nav = byPath.get('game/saves/navigation.json')
    if (nav) {
      try {
        const j = JSON.parse((await readAll(await nav.open(), 8 << 20)).toString('utf-8'))
        if (Array.isArray(j.size)) out.screen = [Number(j.size[0]), Number(j.size[1])]
        if (typeof j.version === 'string') out.version = j.version
        if (typeof j.name === 'string') out.title = j.name
      } catch {}
    }
    for (const e of src.entries) {
      if (out.saveDir) break
      if (/^game\/.*options\.rpy$/i.test(e.path) && e.size < 4 << 20) out.saveDir = saveDirFromSource((await readAll(await e.open())).toString('utf-8')) ?? undefined
    }
    const rpycs = src.entries.filter((e) => /^game\/.*\.rpyc$/i.test(e.path) && e.size < 16 << 20)
    rpycs.sort((a, b) => Number(!/options/i.test(a.path)) - Number(!/options/i.test(b.path)))
    for (const e of rpycs.slice(0, 400)) {
      if (out.saveDir) break
      out.saveDir = saveDirFromRpyc(await readAll(await e.open())) ?? undefined
    }
    if (!out.screen) {
      // The most common progressive image size is almost always the screen size.
      const rf = byPath.get('game/renpyweb_remote_files.txt')
      if (rf) {
        const counts = new Map<string, number>()
        for (const m of (await readAll(await rf.open(), 64 << 20)).toString('utf-8').matchAll(/^image (\d+),(\d+)$/gm)) {
          const k = `${m[1]}x${m[2]}`
          counts.set(k, (counts.get(k) ?? 0) + 1)
        }
        const top = [...counts].sort((a, b) => b[1] - a[1])[0]
        if (top) {
          const [w, h] = top[0].split('x').map(Number)
          out.screen = [w!, h!]
        }
      }
    }
  } finally {
    src.close()
  }
  return out
}

/**
 * Converts the images of an installed web build to WebP in place (streamed
 * assets and the GUI inside game.zip). Works on legacy builds too.
 */
export async function optimizeBuild(ctx: JobContext<{ slug: string; quality?: number }>, deps: MaintainDeps): Promise<unknown> {
  const { cfg, db } = deps
  const slug = ctx.params.slug
  const dir = deps.library.gameDir(slug)
  if (!(await exists(join(dir, 'index.html')))) throw new Error('Game is not installed')
  const policy = defaultImagePolicy(ctx.params.quality ?? cfg.imageQuality)
  const limiter = new Limiter(imageConcurrency(cfg.imageConcurrency))
  let converted = 0
  let before = 0
  let after = 0

  ctx.progress('Scanning files')
  const files = (await walkFiles(join(dir, 'game'))).filter((f) => isOptimizableImage(f.rel))
  let done = 0
  for (const f of files) {
    ctx.checkAbort()
    await limiter.run(async () => {
      const data = await readFile(f.full)
      const r = await transcodeImage(data, f.rel, policy)
      if (r.changed) {
        await writeFileAtomic(f.full, r.data)
        converted++
        before += data.length
        after += r.data.length
      }
      done++
      if (done % 50 === 0) ctx.progress('Optimizing streamed images', done / files.length, `${done}/${files.length}`)
    })
  }
  await limiter.drain()
  ctx.log(`Streamed images: ${converted}/${files.length} converted, ${(before / 1e9).toFixed(2)} GB -> ${(after / 1e9).toFixed(2)} GB`)

  ctx.progress('Optimizing game.zip', 0)
  const zipRes = await rewriteZip(join(dir, 'game.zip'), ctx, async (name, data) => {
    if (!name.startsWith('game/') || !isOptimizableImage(name.slice(5))) return null
    const r = await transcodeImage(data, name.slice(5), policy)
    return r.changed ? r.data : null
  })
  converted += zipRes.changed
  before += zipRes.before
  after += zipRes.after
  ctx.log(`game.zip: ${(zipRes.sizeBefore / 1e6).toFixed(0)} MB -> ${(zipRes.sizeAfter / 1e6).toFixed(0)} MB`)

  const engine = (await exists(join(dir, 'renpy.wasm'))) ? await registerEngine(cfg.enginesDir, dir) : null
  if (engine) await stripEngine(dir)
  const prev = await readMarker(dir)
  const game = db.getGame(slug)
  const marker: BuildMarker = {
    schema: 1,
    slug,
    buildId: newBuildId(),
    zipRev: 0,
    engine: engine ?? prev?.engine ?? (game?.engine || null),
    title: prev?.title ?? game?.title,
    version: prev?.version ?? game?.version,
    saveDir: prev?.saveDir ?? (game?.save_dir || undefined),
    screen: prev?.screen ?? (game?.screen_w ? [game.screen_w, game.screen_h] : undefined),
    createdAt: prev?.createdAt ?? new Date().toISOString(),
    optimized: { images: converted + (prev?.optimized?.images ?? 0), before: before + (prev?.optimized?.before ?? 0), after: after + (prev?.optimized?.after ?? 0) },
    mods: prev?.mods ?? null,
  }
  await writeMarker(dir, marker)
  const size = await dirSize(dir)
  db.updateGame(slug, { layout: 'managed', build_id: marker.buildId, engine: marker.engine ?? '', size_bytes: size.bytes, file_count: size.files })
  return { converted, before, after, size: size.bytes }
}

interface RewriteResult {
  changed: number
  before: number
  after: number
  sizeBefore: number
  sizeAfter: number
}

/** Streams a zip into a new one, letting `transform` replace small entries. */
async function rewriteZip(
  path: string,
  ctx: JobContext,
  transform: (name: string, data: Buffer) => Promise<Buffer | null>,
): Promise<RewriteResult> {
  const res: RewriteResult = { changed: 0, before: 0, after: 0, sizeBefore: (await stat(path)).size, sizeAfter: 0 }
  const tmp = `${path}.new`
  const out = new yazl.ZipFile()
  const written = pipeline(out.outputStream, createWriteStream(tmp))
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (e, z) => (e || !z ? reject(e) : resolve(z))),
  )
  const total = zip.entryCount
  let n = 0
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject)
    zip.on('end', () => resolve())
    zip.on('entry', (e: yauzl.Entry) => {
      n++
      if (n % 200 === 0) ctx.progress('Optimizing game.zip', n / total)
      if (e.fileName.endsWith('/')) {
        out.addEmptyDirectory(e.fileName, { mtime: e.getLastModDate() })
        return zip.readEntry()
      }
      zip.openReadStream(e, async (err, s) => {
        if (err || !s) return reject(err)
        try {
          const compress = e.compressionMethod !== 0
          if (e.uncompressedSize < 64 << 20) {
            const data = await readAll(s)
            const next = await transform(e.fileName, data)
            if (next) {
              res.changed++
              res.before += data.length
              res.after += next.length
            }
            out.addBuffer(next ?? data, e.fileName, { mtime: e.getLastModDate(), compress: next ? false : compress })
          } else {
            out.addReadStream(s, e.fileName, { mtime: e.getLastModDate(), compress, size: e.uncompressedSize })
          }
          zip.readEntry()
        } catch (er) {
          reject(er)
        }
      })
    })
    zip.readEntry()
  })
  zip.close()
  out.end()
  await written
  res.sizeAfter = (await stat(tmp)).size
  await rename(tmp, path)
  return res
}

// ---- Mods ------------------------------------------------------------------

const ORIG_DIR = '.renplay-orig'

/**
 * Applies the overlay of a game: starts from the pristine game.zip and
 * pristine streamed assets, layers the overlay on top, compiles scripts and
 * repacks game.zip.
 */
export async function applyMods(ctx: JobContext<{ slug: string }>, deps: MaintainDeps): Promise<unknown> {
  const { cfg, db, overlays } = deps
  const slug = ctx.params.slug
  const dir = deps.library.gameDir(slug)
  if (!(await exists(join(dir, 'game.zip')))) throw new Error('Game is not installed')
  const work = join(cfg.workDir, ctx.id)
  await rm(work, { recursive: true, force: true })
  const tree = join(work, 'tree')
  try {
    // Pristine copies, made once before the first mod is applied.
    const origDir = join(dir, ORIG_DIR)
    const pristineZip = join(origDir, 'game.zip')
    await mkdir(origDir, { recursive: true })
    if (!(await exists(pristineZip))) await copyFile(join(dir, 'game.zip'), pristineZip)
    const origAssets = join(origDir, 'assets')

    // Restore streamed assets touched by a previous apply.
    for (const f of await walkFiles(origAssets)) {
      const dest = safeJoin(dir, f.rel)
      await mkdir(dirname(dest), { recursive: true })
      await rename(f.full, dest)
    }

    ctx.progress('Unpacking game.zip')
    const zipNames = await extractZip(pristineZip, tree, ctx)
    const { files, deleted } = await overlays.list(slug)
    let assetsChanged = false
    const saveOrig = async (rel: string) => {
      const src = safeJoin(dir, rel)
      if (!(await exists(src))) return
      const dest = safeJoin(origAssets, rel)
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(src, dest)
    }
    let scripts = 0
    for (const f of files) {
      const data = await overlays.read(slug, f.path)
      if (!data) continue
      if (/\.rpy$/i.test(f.path)) scripts++
      const inZip = zipNames.has(f.path)
      const streamed = !inZip && (await exists(safeJoin(dir, f.path)))
      if (streamed) {
        await saveOrig(f.path)
        await writeFileAtomic(safeJoin(dir, f.path), data)
        assetsChanged = true
      } else {
        const dest = safeJoin(tree, f.path)
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, data)
      }
    }
    for (const d of deleted) {
      if (zipNames.has(d)) await rm(safeJoin(tree, d), { force: true })
      else if (await exists(safeJoin(dir, d))) {
        await saveOrig(d)
        await rm(safeJoin(dir, d), { force: true })
        assetsChanged = true
      }
      // A compiled script must disappear together with its source.
      if (d.endsWith('.rpy')) await rm(safeJoin(tree, d + 'c'), { force: true })
    }
    ctx.log(`Overlay: ${files.length} files, ${deleted.length} deletions${assetsChanged ? ', streamed assets changed' : ''}`)

    if (scripts) {
      try {
        const sdk = await deps.sdk.ensure(ctx)
        ctx.progress('Compiling scripts')
        await deps.sdk.compile(sdk, tree, ctx)
      } catch (e) {
        throw new Error(`Script compilation failed — check your mod files. ${(e as Error).message}`)
      }
    }

    ctx.progress('Repacking game.zip')
    const tmp = join(dir, 'game.zip.new')
    await zipDir(tree, tmp, ctx)
    await rename(tmp, join(dir, 'game.zip'))

    const prev = (await readMarker(dir)) ?? null
    const game = db.getGame(slug)
    const marker: BuildMarker = {
      schema: 1,
      slug,
      buildId: assetsChanged || !prev ? newBuildId() : prev.buildId,
      zipRev: (prev?.zipRev ?? 0) + 1,
      engine: prev?.engine ?? (game?.engine || null),
      title: prev?.title ?? game?.title,
      version: prev?.version ?? game?.version,
      saveDir: prev?.saveDir ?? (game?.save_dir || undefined),
      screen: prev?.screen,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
      optimized: prev?.optimized,
      mods: files.length || deleted.length ? { hash: await overlays.hash(slug), files: files.length + deleted.length, appliedAt: new Date().toISOString() } : null,
    }
    await writeMarker(dir, marker)
    db.updateGame(slug, { build_id: marker.buildId, layout: 'managed', mods_state: marker.mods ? 'applied' : '' })
    return { files: files.length, deleted: deleted.length, zipRev: marker.zipRev, buildId: marker.buildId }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

async function extractZip(path: string, dest: string, ctx: JobContext): Promise<Set<string>> {
  const names = new Set<string>()
  const src = await openZip(path)
  try {
    let n = 0
    for (const e of src.entries) {
      ctx.checkAbort()
      const out = safeJoin(dest, e.path)
      await mkdir(dirname(out), { recursive: true })
      await pipeline(await e.open(), createWriteStream(out))
      names.add(e.path)
      if (++n % 500 === 0) ctx.progress('Unpacking game.zip', n / src.entries.length)
    }
  } finally {
    src.close()
  }
  return names
}

const STORED = /\.(png|jpe?g|webp|avif|ogg|opus|mp3|webm|mp4|zip|rpa|ttf|otf)$/i

async function zipDir(root: string, dest: string, ctx: JobContext): Promise<void> {
  const files = await walkFiles(root)
  const out = new yazl.ZipFile()
  const done = pipeline(out.outputStream, createWriteStream(dest))
  let n = 0
  for (const f of files) {
    out.addReadStream(createReadStream(f.full), f.rel, { compress: !STORED.test(f.rel), size: f.size })
    if (++n % 500 === 0) ctx.progress('Repacking game.zip', n / files.length)
  }
  out.end()
  await done
}

/** Lists the files a player can browse in the mod editor (from game.zip and streamed assets). */
export async function baseFiles(gameDir: string): Promise<Map<string, { size: number; where: 'zip' | 'dir' }>> {
  const out = new Map<string, { size: number; where: 'zip' | 'dir' }>()
  const origZip = join(gameDir, ORIG_DIR, 'game.zip')
  const zipPath = (await exists(origZip)) ? origZip : join(gameDir, 'game.zip')
  if (await exists(zipPath)) {
    const src = await openZip(zipPath)
    for (const e of src.entries) if (e.path.startsWith('game/') && !/^game\/(cache|saves)\//.test(e.path)) out.set(e.path, { size: e.size, where: 'zip' })
    src.close()
  }
  for (const f of await walkFiles(join(gameDir, 'game'))) out.set(`game/${f.rel}`, { size: f.size, where: 'dir' })
  // Originals of streamed assets replaced by a mod.
  for (const f of await walkFiles(join(gameDir, ORIG_DIR, 'assets'))) out.set(f.rel, { size: f.size, where: 'dir' })
  return out
}

export async function readBaseFile(gameDir: string, path: string): Promise<Buffer | null> {
  const orig = join(gameDir, ORIG_DIR, 'assets', path)
  if (await exists(orig)) return readFile(orig)
  const direct = safeJoin(gameDir, path)
  if (path.startsWith('game/') && (await exists(direct))) return readFile(direct)
  const origZip = join(gameDir, ORIG_DIR, 'game.zip')
  const zipPath = (await exists(origZip)) ? origZip : join(gameDir, 'game.zip')
  const src = await openZip(zipPath)
  try {
    const e = src.entries.find((x) => x.path === path)
    return e ? await readAll(await e.open(), 256 << 20) : null
  } finally {
    src.close()
  }
}

export { MARKER }
