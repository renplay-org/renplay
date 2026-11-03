import { mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { baseOf, newBuildId, type BuildInfo, type Builds } from '../builds.js'
import type { Catalog, RecipeMatch } from '../catalog.js'
import type { Config } from '../config.js'
import { parseJson, type BuildOptions, type Db, type GameRow, type GameSource } from '../db.js'
import type { EngineStore } from '../engines.js'
import type { JobContext } from '../jobs.js'
import type { Overlays } from '../mods.js'
import { dirSize, exists } from '../util/fsx.js'
import { HttpError, cleanRelPath, isSlug, safeJoin } from '../util/paths.js'
import { extractWithBsdtar, openDir, openZip, readAll, sniffArchive, type ArchiveSource, type SourceEntry } from './archive.js'
import { assemble } from './assemble.js'
import { nameVersionFromSource, renpyVersionFromVc, saveDirFromRpyc, saveDirFromSource, vcNeedsInit } from './detect.js'
import { defaultImagePolicy, imageConcurrency } from './optimize.js'
import { PackWriter, writeIndex } from './pack.js'
import { DEFAULT_PROGRESSIVE_RULES, buildRules, excluder, parseRules } from './progressive.js'
import { detectEngine, type EngineInfo } from './family.js'
import { detectLayout, extractProject } from './project.js'
import { readRpaIndex, splitRpa } from './rpa.js'

export interface ImportParams {
  /** An archive in the archives folder (copied there, or uploaded). */
  source: { kind: 'archive'; path: string }
  /** Install into this game (update or reinstall). */
  game?: string
  recipeId?: string
  /** Engine version to build with instead of the recipe's or the newest matching one. */
  engine?: string
  reapplyMods?: boolean
}

export interface ImportDeps {
  cfg: Config
  db: Db
  builds: Builds
  engines: EngineStore
  overlays: Overlays
  catalog: Catalog
}

export async function runImport(ctx: JobContext<ImportParams>, deps: ImportDeps): Promise<unknown> {
  const result = await install(ctx, deps)
  // After install() closed the archive: on NFS, deleting an open file leaves a hidden copy behind.
  if (deps.cfg.deleteArchives) await deleteSource(ctx, deps)
  return result
}

/** Removes the archive a game was installed from. Failing to only costs space. */
export async function deleteSource(ctx: JobContext<ImportParams>, deps: ImportDeps): Promise<void> {
  const rel = cleanRelPath(ctx.params.source.path)
  const path = safeJoin(deps.cfg.archivesDir, rel)
  try {
    const st = await stat(path)
    if (!st.isFile()) return
    await unlink(path)
    deps.db.deleteArchive(rel)
    ctx.log(`Deleted ${rel} (${(st.size / 1e9).toFixed(2)} GB) from the archives folder; add it again to reinstall`)
  } catch (e) {
    ctx.log(`Could not delete ${rel}: ${(e as Error).message}`)
  }
}

async function install(ctx: JobContext<ImportParams>, deps: ImportDeps): Promise<unknown> {
  const { cfg, db, builds, engines, catalog } = deps
  const p = ctx.params
  const work = join(cfg.workDir, ctx.id)
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  let src: ArchiveSource | null = null
  try {
    // 1. Source archive.
    const source: GameSource = {}
    const archivePath = safeJoin(cfg.archivesDir, cleanRelPath(p.source.path))
    if (!(await exists(archivePath))) throw new Error(`Archive not found: ${p.source.path}`)
    source.archive = relative(cfg.archivesDir, archivePath)
    const st = await stat(archivePath)
    source.size = st.size
    const known = db.getArchive(source.archive)
    if (known?.sha256 && known.size === st.size && known.mtime_ms === Math.floor(st.mtimeMs)) source.sha256 = known.sha256
    ctx.log(`Source: ${source.archive} (${(st.size / 1e9).toFixed(2)} GB)`)

    // 2. Recipe.
    let match: RecipeMatch | null = null
    if (p.recipeId) {
      const recipe = catalog.recipe(p.recipeId)
      if (!recipe) throw new Error(`Recipe ${p.recipeId} is not in the catalog`)
      const auto = catalog.match({ name: source.archive, size: source.size, sha256: source.sha256 })
      match = auto?.recipe.id === recipe.id ? auto : { recipe, release: null, exact: false }
    } else {
      match = catalog.match({ name: source.archive, size: source.size, sha256: source.sha256 })
    }
    if (match) ctx.log(`Recipe: ${match.recipe.id}${match.release ? ` (${match.release.version}, ${match.release.status})` : ' (unlisted version)'}`)
    const settings = match ? catalog.settings(match.recipe, match.release) : {}

    // 3. Open.
    ctx.progress('Opening archive')
    const type = await sniffArchive(archivePath)
    if (type === 'zip') src = await openZip(archivePath)
    else if (type === '7z' || type === 'rar' || type === 'tar') {
      ctx.progress('Unpacking archive', 0, `${type} archives are unpacked to scratch space first`)
      await extractWithBsdtar(archivePath, join(work, 'raw'), ctx.signal, (l) => ctx.log(l))
      src = await openDir(join(work, 'raw'))
    } else throw new Error('Unsupported archive format (expected zip, 7z, rar or tar)')
    const layout = detectLayout(src.entries)
    if (!layout) {
      const other = await detectEngine(src.entries, null)
      if (other) throw new Error(`This is a ${other.label} game. ${other.reason ?? ''}`.trim())
      throw new Error('No game found in the archive (no Ren’Py game/ folder with scripts, no page or game pack)')
    }
    if (layout.kind === 'web') throw new Error('This is a web build. Use the game’s PC download; renplay builds the web version itself.')

    // 4. Engine, from the recipe or the game's own Ren'Py version.
    const gameRenpy = await renpyVersionOf((p) => src!.entries.find((e) => e.path === layout.root + p))
    const engine = await engines.pick(p.engine ?? settings.engine, gameRenpy ?? match?.release?.madeWith)
    ctx.log(`Game made with Ren'Py ${gameRenpy ?? 'unknown'}; building with engine ${engine}`)
    if (gameRenpy && Number(gameRenpy.split('.')[0]) < Number(engine.split('.')[0])) {
      ctx.log(`Made with an older Ren'Py: most such games work on the newer engine, but Python 2 code in the game can fail while playing. Report problems to the catalog.`)
    }
    const engineDir = await engines.ensure(engine, ctx)

    // 5. Extract and optimize.
    const options: BuildOptions = {
      optimizeImages: settings.optimize ?? true,
      imageQuality: settings.quality ?? cfg.imageQuality,
    }
    const policy = { ...defaultImagePolicy(options.imageQuality), enabled: options.optimizeImages !== false }
    const staging = join(work, 'build')
    await mkdir(staging, { recursive: true })
    // A progressive_download.txt shipped by the developer replaces the defaults.
    const shipped = src.entries.find((e) => e.path === `${layout.root}progressive_download.txt`)
    const baseRules = shipped ? (await readAll(await shipped.open(), 1 << 20)).toString('utf-8') : DEFAULT_PROGRESSIVE_RULES
    if (shipped) ctx.log('Using the game’s own progressive_download.txt')
    const rules = parseRules(buildRules(settings.keep, baseRules))

    // Recipe patches and re-applied mods replace game files; hidden files are left out.
    const existingForMods = p.reapplyMods ? (p.game ? db.getGame(p.game) : match ? db.gameByRecipe(match.recipe.id) : null) : null
    const extra = match ? await catalog.patches(match.recipe, ctx) : new Map<string, Buffer>()
    const skip = new Set<string>(extra.keys())
    if (existingForMods) {
      const mods = await deps.overlays.forBuild(existingForMods.id)
      for (const [rel, data] of mods.files) {
        extra.set(rel, data)
        skip.add(rel)
      }
      for (const h of mods.hidden) skip.add(h)
      if (mods.files.size + mods.hidden.size) ctx.log(`Re-applying ${mods.files.size} modded and ${mods.hidden.size} hidden files`)
    }

    // 5. Extract and optimize, straight into the packs.
    const assets = new PackWriter(join(staging, 'assets.pack'))
    const zipPack = new PackWriter(join(work, 'zip.pack'))
    let res
    try {
      res = await extractProject(src, layout.root, staging, policy, imageConcurrency(cfg.imageConcurrency), ctx, rules, { assets, zip: zipPack, skip }, excluder(settings.exclude))
    } finally {
      await Promise.allSettled([assets.close(), zipPack.close()])
    }
    src.close()
    src = null
    await rm(join(staging, 'progressive_download.txt'), { force: true })
    const s = res.stats
    ctx.log(
      `Extracted ${s.files} files, split ${s.archivesSplit} archives` +
        (s.imagesConverted ? `, converted ${s.imagesConverted} images ${(s.imageBytesBefore / 1e9).toFixed(2)} GB -> ${(s.imageBytesAfter / 1e9).toFixed(2)} GB` : ''),
    )
    const meta = res.meta
    const saveDir = meta.saveDir ?? match?.recipe.saveDir

    // 6. Game id: the existing game, the recipe, or the title.
    const existing =
      (p.game ? db.getGame(p.game) : null) ??
      (match ? db.gameByRecipe(match.recipe.id) : null) ??
      (saveDir ? db.gameBySaveDir(saveDir) : null)
    if (p.game && !existing) throw new HttpError(404, `Game ${p.game} not found`)
    const id = existing?.id ?? (match && !db.getGame(match.recipe.id) ? match.recipe.id : builds.uniqueId(match?.recipe.title || meta.title || basename(archivePath).replace(/\.[^.]+$/, '')))
    if (!isSlug(id)) throw new Error(`Invalid game id ${id}`)

    // 7. game.zip.
    ctx.progress('Packing game.zip', 0)
    const asm = await assemble({
      dir: staging,
      renpyZip: join(engineDir, 'renpy.zip'),
      zipPack: { path: join(work, 'zip.pack'), index: zipPack.index },
      assets: assets.index,
      rules,
      placeholders: res.placeholders,
      extra,
      ctx,
    })
    await writeIndex(join(staging, 'assets.json'), assets.index)
    await rm(join(work, 'zip.pack'), { force: true })
    ctx.log(`game.zip ${(asm.zipBytes / 1e6).toFixed(0)} MB (${asm.zipped} files), ${asm.streamed.files} files stream (${(asm.streamed.bytes / 1e9).toFixed(2)} GB)`)

    // 9. Install: rename the staging folder into place (same filesystem).
    ctx.progress('Installing')
    const build = newBuildId()
    const info: BuildInfo = {
      schema: 1,
      game: id,
      build,
      engine,
      renpyVersion: gameRenpy,
      title: meta.title,
      version: meta.version,
      saveDir,
      screen: meta.screen,
      createdAt: new Date().toISOString(),
      images: { converted: s.imagesConverted, before: s.imageBytesBefore, after: s.imageBytesAfter },
      streamed: asm.streamed,
      zipBytes: asm.zipBytes,
      mods: p.reapplyMods && existing ? await modsInfo(deps, existing.id) : null,
    }
    await builds.writeInfo(staging, info)
    await mkdir(builds.gameDir(id), { recursive: true })
    await rename(staging, builds.dir(id, build))
    const size = await dirSize(builds.dir(id, build))

    const previous = existing?.build ? baseOf(existing.build) : undefined
    if (existing && !p.reapplyMods && (await deps.overlays.summary(existing.id)).files) {
      await deps.overlays.archive(existing.id)
      ctx.log('Previous mods were moved aside (not re-applied to this version)')
    }
    const row: Partial<GameRow> = {
      status: 'installed',
      recipe_id: match?.recipe.id ?? existing?.recipe_id ?? '',
      version: meta.version ?? match?.release?.version ?? '',
      renpy_version: gameRenpy ?? '',
      engine,
      build,
      size_bytes: size.bytes,
      file_count: size.files,
      source: JSON.stringify(source),
      build_options: JSON.stringify(options),
      installed_at: new Date().toISOString(),
    }
    if (saveDir) row.save_dir = saveDir
    if (meta.screen) {
      row.screen_w = meta.screen[0]
      row.screen_h = meta.screen[1]
    }
    if (existing) db.updateGame(id, row)
    else db.insertGame({ id, title: meta.title || match?.recipe.title || id, ...row })

    await builds.prune(id, previous)
    await engines.prune(new Set(db.allGames().map((g) => g.engine).filter(Boolean)))
    ctx.log(`Installed ${id} (build ${build}, engine ${engine}, ${(size.bytes / 1e9).toFixed(2)} GB)`)
    return { game: id, build, engine, size: size.bytes, zipBytes: asm.zipBytes, saveDir, title: meta.title, version: meta.version, images: info.images, recipe: match?.recipe.id ?? null }
  } finally {
    src?.close()
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

async function modsInfo(deps: ImportDeps, id: string): Promise<BuildInfo['mods']> {
  const s = await deps.overlays.summary(id)
  return s.files + s.deleted ? { hash: s.hash, files: s.files + s.deleted } : null
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
  /** What made the game (Ren'Py, Twine, Godot…), and whether it installs. */
  engine?: EngineInfo
  /** INSPECT_VERSION of the inspection; older results are inspected again. */
  v?: number
}

/** Bump when inspectArchive learns to find more. 2: Ren'Py 7 versions. 3: other engines. */
export const INSPECT_VERSION = 3

/**
 * Reads metadata from a zip without extracting it. Script archives (.rpa) are
 * only read when small, so the save folder of a game that keeps its scripts in
 * a large one is known once it is installed.
 */
export async function inspectArchive(path: string): Promise<ArchiveInfo> {
  const type = await sniffArchive(path)
  if (type !== 'zip') return { type, layout: null, files: 0, v: INSPECT_VERSION }
  const src = await openZip(path)
  try {
    const layout = detectLayout(src.entries)
    const engine = await detectEngine(src.entries, layout)
    const info: ArchiveInfo = { type, layout: layout?.kind ?? null, files: src.entries.length, engine: engine ?? undefined, v: INSPECT_VERSION }
    if (engine && engine.family !== 'renpy') info.title = engine.title
    if (!layout || layout.kind === 'web') return info
    const root = layout.root
    const byPath = new Map(src.entries.map((e) => [e.path, e]))
    const bi = byPath.get(root + 'game/cache/build_info.json')
    if (bi) {
      const j = parseJson<{ name?: string; version?: string }>((await readAll(await bi.open(), 1 << 20)).toString('utf-8'), {})
      info.title = j.name
      info.version = j.version
    }
    info.renpyVersion = await renpyVersionOf((p) => byPath.get(root + p))
    const consider = (name: string, data: Buffer) => {
      if (name.endsWith('.rpy')) {
        const text = data.toString('utf-8')
        info.saveDir ??= saveDirFromSource(text) ?? undefined
        const nv = nameVersionFromSource(text)
        info.title ??= nv.name
        info.version ??= nv.version
      } else if (name.endsWith('.rpyc')) info.saveDir ??= saveDirFromRpyc(data) ?? undefined
    }
    for (const e of src.entries) {
      if (e.path.startsWith(root + 'game/') && /options\.rpyc?$/i.test(e.path) && e.size < 4 << 20) consider(e.path, await readAll(await e.open()))
    }
    if (!info.saveDir) {
      const rpas = src.entries.filter((e) => e.path.startsWith(root + 'game/') && e.path.endsWith('.rpa') && e.size < 512 << 20)
      rpas.sort((a, b) => Number(!/script/i.test(a.path)) - Number(!/script/i.test(b.path)) || a.size - b.size)
      for (const e of rpas.slice(0, 4)) {
        const idx = await readRpaIndex(e).catch(() => null)
        const want = idx?.files.filter((f) => /(^|\/)options\.rpyc?$/i.test(f.name)) ?? []
        if (!want.length) continue
        const got = new Map<string, Buffer>()
        await splitRpa(e, want, {
          open: async (name) => {
            const chunks: Buffer[] = []
            return { write: (c) => void chunks.push(Buffer.from(c)), end: async () => void got.set(name, Buffer.concat(chunks)) }
          },
        })
        for (const [n, d] of got) consider(n, d)
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
}

/** The game's Ren'Py version from its renpy/ folder (see renpyVersionFromVc). */
async function renpyVersionOf(find: (path: string) => SourceEntry | undefined): Promise<string | undefined> {
  const vc = find('renpy/vc_version.py')
  if (!vc) return undefined
  const text = async (e: SourceEntry) => (await readAll(await e.open(), 1 << 20)).toString('utf-8')
  const src = await text(vc)
  const init = vcNeedsInit(src) ? find('renpy/__init__.py') : undefined
  return renpyVersionFromVc(src, init ? await text(init) : undefined)
}
