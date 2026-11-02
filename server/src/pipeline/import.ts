import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Config } from '../config.js'
import type { Db, GameRow, GameSource } from '../db.js'
import type { JobContext } from '../jobs.js'
import { newBuildId, writeMarker, type BuildMarker, type Library } from '../library.js'
import { dirSize, exists, trashDir } from '../util/fsx.js'
import { HttpError, cleanRelPath, isSlug, safeJoin } from '../util/paths.js'
import { extractWithBsdtar, openDir, openZip, readAll, sniffArchive, type ArchiveSource } from './archive.js'
import { nameVersionFromSource, saveDirFromRpyc, saveDirFromSource } from './detect.js'
import { registerEngine, stripEngine } from './engine.js'
import { defaultImagePolicy, imageConcurrency, makeCover } from './optimize.js'
import { DEFAULT_PROGRESSIVE_RULES, detectLayout, extractProject } from './project.js'
import { parseRules } from './progressive.js'
import { readRpaIndex, splitRpa } from './rpa.js'
import type { SdkManager } from './sdk.js'
import type { Overlays } from '../mods.js'
import type { Catalog, Recipe } from '../catalog.js'

export interface ImportParams {
  source: { kind: 'archive'; path: string } | { kind: 'url'; url: string; filename?: string }
  /** Install into this game (update/reinstall). */
  slug?: string
  title?: string
  optimizeImages?: boolean
  imageQuality?: number
  reapplyMods?: boolean
  recipeId?: string
}

export interface ImportDeps {
  cfg: Config
  db: Db
  library: Library
  sdk: SdkManager
  overlays: Overlays
  catalog: Catalog
}

export async function runImport(ctx: JobContext<ImportParams>, deps: ImportDeps): Promise<unknown> {
  const { cfg, db } = deps
  const p = ctx.params
  const work = join(cfg.workDir, ctx.id)
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  let src: ArchiveSource | null = null
  try {
    // 1. Source archive.
    let archivePath: string
    let source: GameSource
    if (p.source.kind === 'url') {
      archivePath = await downloadToArchives(p.source.url, p.source.filename, cfg, ctx)
      source = { kind: 'url', url: p.source.url, archive: relative(cfg.archivesDir, archivePath), filename: basename(archivePath) }
    } else {
      const rel = cleanRelPath(p.source.path)
      archivePath = safeJoin(cfg.archivesDir, rel)
      if (!(await exists(archivePath))) throw new Error(`Archive not found: ${rel}`)
      source = { kind: 'archive', archive: rel, filename: basename(rel) }
    }
    const archiveStat = await stat(archivePath)
    source.archiveSize = archiveStat.size
    const known = db.getArchive(source.archive!)
    if (known?.sha256 && known.size === archiveStat.size && known.mtime_ms === Math.floor(archiveStat.mtimeMs)) {
      source.archiveSha256 = known.sha256
    }
    ctx.log(`Source: ${archivePath} (${(archiveStat.size / 1e9).toFixed(2)} GB)`)

    // 2. Open.
    ctx.progress('Opening archive')
    const type = await sniffArchive(archivePath)
    if (type === 'zip') src = await openZip(archivePath)
    else if (type === '7z' || type === 'rar' || type === 'tar') {
      ctx.progress('Unpacking archive', 0, `${type} archives are unpacked to scratch space first`)
      await extractWithBsdtar(archivePath, join(work, 'raw'), ctx.signal, (l) => ctx.log(l))
      src = await openDir(join(work, 'raw'))
    } else throw new Error('Unsupported archive format (expected zip, 7z, rar or tar)')

    const layout = detectLayout(src.entries)
    if (!layout) throw new Error('No Ren’Py game found in the archive (no game/ folder with scripts)')
    ctx.log(`Layout: ${layout.kind} at "${layout.root || '.'}"`)

    const recipe = p.recipeId ? deps.catalog.recipe(p.recipeId) : null
    const quality = p.imageQuality ?? recipe?.build?.imageQuality ?? cfg.imageQuality
    const policy = { ...defaultImagePolicy(quality), enabled: p.optimizeImages ?? recipe?.build?.optimizeImages ?? true }
    const web = join(work, 'web')
    let title: string | undefined
    let version: string | undefined
    let renpyVersion: string | undefined
    let saveDir: string | undefined
    let screen: [number, number] | undefined
    let optimized: BuildMarker['optimized']
    let coverData: Buffer | null = null
    let engine: string | null = null

    if (layout.kind === 'web') {
      // Already a web build: copy as-is.
      ctx.progress('Copying web build')
      await mkdir(web, { recursive: true })
      const entries = src.entries.filter((e) => e.path.startsWith(layout.root))
      let n = 0
      for (const e of entries) {
        ctx.checkAbort()
        const rel = e.path.slice(layout.root.length)
        const out = safeJoin(web, rel)
        await mkdir(join(out, '..'), { recursive: true })
        await pipeline(await e.open(), createWriteStream(out))
        ctx.progress('Copying web build', ++n / entries.length, rel)
      }
      title = await titleFromIndex(web)
    } else {
      // 3. Extract and optimize.
      const project = join(work, 'project')
      const rules = recipe?.build?.progressiveRules ?? DEFAULT_PROGRESSIVE_RULES
      const placeholders = join(work, 'placeholders')
      const res = await extractProject(src, layout.root, project, policy, imageConcurrency(cfg.imageConcurrency), ctx, {
        dir: placeholders,
        rules: parseRules(rules),
      })
      src.close()
      src = null
      const s = res.stats
      ctx.log(
        `Extracted ${s.files} files, split ${s.archivesSplit} archives` +
          (s.imagesConverted
            ? `, converted ${s.imagesConverted} images ${(s.imageBytesBefore / 1e9).toFixed(2)} GB -> ${(s.imageBytesAfter / 1e9).toFixed(2)} GB`
            : ''),
      )
      optimized = { images: s.imagesConverted, before: s.imageBytesBefore, after: s.imageBytesAfter }
      title = res.meta.title
      version = res.meta.version
      renpyVersion = res.meta.renpyVersion
      saveDir = res.meta.saveDir ?? recipe?.saveDir
      coverData = await findCover(project, res.coverCandidates)

      // 4. Build configuration.
      await writeFile(join(project, 'progressive_download.txt'), rules)
      await mkdir(join(project, 'game', 'saves'), { recursive: true })
      if (recipe?.build?.patches?.length) await deps.catalog.applyPatches(recipe, join(project), ctx)
      const targetSlug = resolveSlug(deps, p, saveDir, title)
      if (p.reapplyMods && targetSlug) {
        const n = await deps.overlays.copyInto(targetSlug, project)
        if (n) ctx.log(`Re-applied ${n} modded files`)
      }

      // 5. Web build.
      const sdk = await deps.sdk.ensure(ctx)
      ctx.progress('Building for web', 0)
      await deps.sdk.webBuild(sdk, project, web, ctx, { placeholders })
      const nav = await readJson(join(project, 'game', 'saves', 'navigation.json'))
      if (Array.isArray(nav?.size) && nav.size.length === 2) screen = [Number(nav.size[0]), Number(nav.size[1])]
      if (typeof nav?.name === 'string' && nav.name) title ??= nav.name
      if (typeof nav?.version === 'string' && nav.version) version ??= nav.version
      await rm(project, { recursive: true, force: true })
    }

    // 6. Shared engine + marker.
    ctx.progress('Finalizing')
    engine = await registerEngine(cfg.enginesDir, web)
    if (engine) await stripEngine(web)
    await rm(join(web, 'service-worker.js'), { force: true })
    const slug = resolveSlug(deps, p, saveDir, title) ?? deps.library.uniqueSlug(title || basename(archivePath).replace(/\.[^.]+$/, ''))
    const existing = db.getGame(slug)
    const buildId = newBuildId()
    const marker: BuildMarker = {
      schema: 1,
      slug,
      buildId,
      zipRev: 0,
      engine,
      sdk: cfg.sdkVersion,
      title,
      version,
      saveDir,
      screen,
      createdAt: new Date().toISOString(),
      optimized,
      mods: p.reapplyMods ? ((await deps.overlays.summary(slug)).files ? { hash: await deps.overlays.hash(slug), files: (await deps.overlays.summary(slug)).files, appliedAt: new Date().toISOString() } : null) : null,
    }
    await writeMarker(web, marker)
    const size = await dirSize(web)

    // 7. Swap into place.
    ctx.progress('Installing')
    const dest = deps.library.gameDir(slug)
    await mkdir(cfg.gamesDir, { recursive: true })
    await trashDir(dest, cfg.trashDir)
    await rename(web, dest)

    const thumbnail = existing?.thumbnail || (coverData ? await saveCover(cfg, slug, coverData) : '')
    const modsKept = p.reapplyMods && marker.mods
    if (existing && !p.reapplyMods && (await deps.overlays.summary(slug)).files) {
      await deps.overlays.archive(slug)
      ctx.log('Previous mods were moved aside (not re-applied to this version)')
    }
    const row: Partial<GameRow> = {
      status: 'installed',
      layout: 'managed',
      build_id: buildId,
      version: version ?? '',
      renpy_version: renpyVersion ?? '',
      engine: engine ?? '',
      size_bytes: size.bytes,
      file_count: size.files,
      screen_w: screen?.[0] ?? 0,
      screen_h: screen?.[1] ?? 0,
      source: JSON.stringify(source),
      options: JSON.stringify({ optimizeImages: policy.enabled, imageQuality: quality }),
      installed_at: new Date().toISOString(),
      catalog_id: recipe?.id ?? existing?.catalog_id ?? '',
      thumbnail,
      mods_state: modsKept ? 'applied' : '',
    }
    if (saveDir && (!existing?.save_dir || existing.save_dir_source !== 'manual')) {
      row.save_dir = saveDir
      row.save_dir_source = 'detected'
    }
    if (existing) {
      if (!existing.title || existing.title === existing.slug) row.title = p.title || title || existing.title
      db.updateGame(slug, row)
    } else {
      db.insertGame({ slug, title: p.title || recipe?.title || title || slug, ...row })
    }
    ctx.log(`Installed as ${slug} (build ${buildId}, ${(size.bytes / 1e9).toFixed(2)} GB, ${size.files} files)`)
    return { slug, buildId, size: size.bytes, saveDir, title, version, optimized }
  } finally {
    src?.close()
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

function resolveSlug(deps: ImportDeps, p: ImportParams, saveDir: string | undefined, title: string | undefined): string | null {
  if (p.slug) {
    if (!isSlug(p.slug)) throw new HttpError(400, 'Invalid slug')
    return p.slug
  }
  if (saveDir) {
    const match = deps.db.gameBySaveDir(saveDir)
    if (match) return match.slug
  }
  if (p.recipeId && isSlug(p.recipeId) && deps.db.getGame(p.recipeId)) return p.recipeId
  if (title) {
    const byTitle = deps.db.allGames().find((g) => g.title.toLowerCase() === title.toLowerCase() && !g.save_dir)
    if (byTitle) return byTitle.slug
  }
  return null
}

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return null
  }
}

async function titleFromIndex(dir: string): Promise<string | undefined> {
  try {
    const m = (await readFile(join(dir, 'index.html'), 'utf-8')).match(/<title>([^<]*)<\/title>/i)
    return m?.[1]?.trim() || undefined
  } catch {
    return undefined
  }
}

async function findCover(project: string, candidates: string[]): Promise<Buffer | null> {
  const scored: Array<[string, number]> = []
  for (const c of candidates) {
    const full = c.startsWith('../') ? join(project, c.slice(3)) : join(project, 'game', c)
    try {
      const st = await stat(full)
      const bonus = /main_menu\./i.test(c) ? 4 : /main_menu/i.test(c) ? 2 : /presplash/i.test(c) ? 1 : 0
      scored.push([full, bonus * 1e9 + st.size])
    } catch {}
  }
  scored.sort((a, b) => b[1] - a[1])
  for (const [full] of scored) {
    try {
      return await makeCover(await readFile(full))
    } catch {}
  }
  return null
}

export async function saveCover(cfg: Config, slug: string, data: Buffer): Promise<string> {
  await mkdir(cfg.thumbnailsDir, { recursive: true })
  const name = `${slug}-${Date.now().toString(36)}.webp`
  await writeFile(join(cfg.thumbnailsDir, name), data)
  return name
}

async function downloadToArchives(url: string, filename: string | undefined, cfg: Config, ctx: JobContext): Promise<string> {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) URLs are supported')
  await mkdir(cfg.uploadsDir, { recursive: true })
  const part = join(cfg.uploadsDir, `${ctx.id}.download`)
  let have = 0
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      have = (await stat(part).catch(() => null))?.size ?? 0
      const res = await fetch(url, { signal: ctx.signal, headers: have ? { range: `bytes=${have}-` } : {}, redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      if (have && res.status !== 206) have = 0
      const total = have + (Number(res.headers.get('content-length')) || 0)
      filename ??= contentDispositionName(res.headers.get('content-disposition')) ?? basename(u.pathname) ?? 'download.zip'
      let got = have
      const body = Readable.fromWeb(res.body as any)
      body.on('data', (c: Buffer) => {
        got += c.length
        ctx.progress('Downloading', total ? got / total : 0, `${(got / 1e9).toFixed(2)} GB`)
      })
      await pipeline(body, createWriteStream(part, { flags: have ? 'a' : 'w' }))
      break
    } catch (e) {
      if (ctx.signal.aborted || attempt === 4) throw e
      ctx.log(`Download interrupted (${(e as Error).message}), resuming…`)
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
  }
  const name = (filename || 'download.zip').replace(/[^\w.() -]+/g, '_').slice(0, 180)
  await mkdir(cfg.archivesDir, { recursive: true })
  let dest = join(cfg.archivesDir, name)
  let i = 1
  while (await exists(dest)) dest = join(cfg.archivesDir, name.replace(/(\.[^.]+)?$/, `-${++i}$1`))
  await rename(part, dest)
  return dest
}

function contentDispositionName(h: string | null): string | undefined {
  if (!h) return undefined
  const star = h.match(/filename\*=UTF-8''([^;]+)/i)
  if (star) return decodeURIComponent(star[1]!)
  const plain = h.match(/filename="?([^";]+)"?/i)
  return plain?.[1]
}

// ---- Archive inspection (fast, no extraction) ------------------------------

export interface ArchiveInfo {
  type: string
  layout: 'project' | 'web' | null
  title?: string
  version?: string
  saveDir?: string
  renpyVersion?: string
  files: number
}

/** Reads metadata from a zip without extracting it; skips large archives. */
export async function inspectArchive(path: string): Promise<ArchiveInfo> {
  const type = await sniffArchive(path)
  if (type !== 'zip') return { type, layout: null, files: 0 }
  const src = await openZip(path)
  try {
    const layout = detectLayout(src.entries)
    const info: ArchiveInfo = { type, layout: layout?.kind ?? null, files: src.entries.length }
    if (!layout) return info
    const root = layout.root
    const byPath = new Map(src.entries.map((e) => [e.path, e]))
    if (layout.kind === 'web') {
      const idx = byPath.get(root + 'index.html')
      if (idx) info.title = (await readAll(await idx.open(), 1 << 20)).toString('utf-8').match(/<title>([^<]*)<\/title>/i)?.[1]?.trim()
      return info
    }
    const bi = byPath.get(root + 'game/cache/build_info.json')
    if (bi) {
      try {
        const j = JSON.parse((await readAll(await bi.open(), 1 << 20)).toString('utf-8'))
        info.title = j.name
        info.version = j.version
      } catch {}
    }
    const vc = byPath.get(root + 'renpy/vc_version.py')
    if (vc) info.renpyVersion = (await readAll(await vc.open(), 1 << 20)).toString('utf-8').match(/^version\s*=\s*['"]([^'"]+)/m)?.[1]
    const consider = async (name: string, data: Buffer) => {
      if (name.endsWith('.rpy')) {
        const s = data.toString('utf-8')
        info.saveDir ??= saveDirFromSource(s) ?? undefined
        const nv = nameVersionFromSource(s)
        info.title ??= nv.name
        info.version ??= nv.version
      } else if (name.endsWith('.rpyc') && !info.saveDir) info.saveDir = saveDirFromRpyc(data) ?? undefined
    }
    for (const e of src.entries) {
      if (!e.path.startsWith(root + 'game/')) continue
      if (/options\.rpyc?$/i.test(e.path) && e.size < 4 << 20) await consider(e.path, await readAll(await e.open()))
    }
    if (!info.saveDir) {
      const rpas = src.entries.filter((e) => e.path.startsWith(root + 'game/') && e.path.endsWith('.rpa') && e.size < 512 << 20)
      rpas.sort((a, b) => Number(!/script/i.test(a.path)) - Number(!/script/i.test(b.path)) || a.size - b.size)
      for (const e of rpas.slice(0, 4)) {
        const idx = await readRpaIndex(e).catch(() => null)
        if (!idx) continue
        const want = idx.files.filter((f) => /(^|\/)options\.rpyc?$/i.test(f.name))
        if (!want.length) continue
        const got = new Map<string, Buffer>()
        await splitRpa(e, want, {
          open: async (name) => {
            const chunks: Buffer[] = []
            return { write: (c) => void chunks.push(Buffer.from(c)), end: async () => void got.set(name, Buffer.concat(chunks)) }
          },
        })
        for (const [n, d] of got) await consider(n, d)
        if (info.saveDir) break
      }
    }
    return info
  } finally {
    src.close()
  }
}

/** Removes leftovers from interrupted jobs. */
export async function cleanWorkDir(cfg: Config): Promise<void> {
  try {
    for (const n of await readdir(cfg.workDir)) await rm(join(cfg.workDir, n), { recursive: true, force: true })
  } catch {}
  try {
    for (const n of await readdir(cfg.uploadsDir)) if (n.endsWith('.download')) await unlink(join(cfg.uploadsDir, n)).catch(() => {})
  } catch {}
}

export type { Recipe }
