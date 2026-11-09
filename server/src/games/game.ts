import { join } from 'node:path'
import { viewer } from '../accounts/context.js'
import { isModBuildOf } from './builds.js'
import { playPath } from '../play/routes.js'
import { cachedSaveMeta, cachedSceneHash } from '../saves/cache.js'
import { slotInfo } from '../saves/savefile.js'
import { installedRelease } from '../shared/recipe.js'
import { exists } from '../util/fsx.js'
import { cleanRelPath } from '../util/paths.js'
import type { Accounts } from '../accounts/accounts.js'
import type { Catalog } from '../catalog/catalog.js'
import type { Config } from '../config.js'
import type { ContentMode } from '../content/mode.js'
import { isWebGame, parseJson, type Db, type GameRow, type GameSource } from '../db.js'
import type { JobManager } from '../jobs/manager.js'
import type { ProgressStore } from '../progress/store.js'
import type { SaveStore } from '../saves/store.js'
import type { Overlays } from './mods.js'
import type { Game } from '../shared/api.js'

/** The parts a game's answer is made from. */
export interface GameParts {
  cfg: Config
  db: Db
  content: ContentMode
  accounts: Accounts
  progress: ProgressStore
  saves: SaveStore
  jobs: JobManager
  overlays: Overlays
  catalog: Catalog
}

/** A game as the library shows it to the signed-in person. */
export async function toGame(game: GameRow, deps: GameParts): Promise<Game> {
  const row = deps.progress.of(deps.accounts.current().id, game)
  const source = parseJson<GameSource>(row.source, {})
  const job = deps.jobs.activeFor(row.id)
  let latestSave: { file: string; label: string; name: string; ctime: number; runtime: number | undefined; screenshot: string | null; screenshotHash?: string | null } | null = null
  let latestFile: { name: string; mtimeMs: number; size: number } | null = null
  let saves = { count: 0, latest: 0 }
  if (row.save_dir) {
    try {
      const files = (await deps.saves.list(row.save_dir)).filter((f) => f.name.endsWith('.save') && !f.name.startsWith('_') && !f.name.includes('/'))
      saves = { count: files.length, latest: files.reduce((m, f) => Math.max(m, f.mtimeMs), 0) }
      for (const f of files) {
        const meta = await cachedSaveMeta(deps.saves, row.save_dir, f)
        if (!meta) continue
        const ctime = meta.ctime ? meta.ctime * 1000 : f.mtimeMs
        if (!latestSave || ctime > latestSave.ctime) {
          latestSave = {
            file: f.name, label: slotInfo(f.name).label, name: meta.name ?? '', ctime, runtime: meta.runtime,
            screenshot: meta.hasScreenshot ? `/api/saves/${row.id}/screenshot?user=${deps.accounts.current().id}&file=${encodeURIComponent(f.name)}&v=${f.mtimeMs}` : null,
          }
          latestFile = f
        }
      }
    } catch {
      // A game whose saves cannot be read shows without its latest save.
    }
  }
  const mods = await deps.overlays.summary(row.id)
  const recipe = row.recipe_id ? deps.catalog.recipe(row.recipe_id) : null
  const release = recipe ? installedRelease(recipe, row.version, source.archive) : null
  const update = recipe ? deps.catalog.update(recipe, row.version, source.archive) : null
  // Blurred: the game shows with its title and metadata, but no picture URL leaves the server.
  const blurred = deps.content.blurs(row)
  if (blurred && latestSave && latestFile && row.save_dir) {
    // Only the picture's hash, a soft blur of its colours.
    latestSave.screenshotHash = latestSave.screenshot ? await cachedSceneHash(deps.saves, row.save_dir, latestFile) : null
    latestSave.screenshot = null
  }
  return {
    id: row.id,
    // Title, developer, tags and cover come from the catalog. A game without a
    // recipe shows the name it declares itself.
    title: recipe?.title ?? row.title,
    developer: recipe?.developer ?? null,
    tags: recipe?.tags ?? [],
    tagIds: recipe?.tagIds ?? [],
    content: recipe?.content ?? [],
    state: recipe?.state ?? null,
    summary: recipe?.summary ?? null,
    // A game without a recipe can be marked adult in the library, and its tile says so too.
    nsfw: recipe?.nsfw ?? row.adult === 1,
    free: recipe?.free,
    // The five formats. Below Shown an adult game's formats are hashes and tints, no address.
    art: deps.catalog.gameArt(row),
    /** The walkthrough files, in order: PDFs, pictures and plain text. */
    walkthroughs: deps.db.walkthroughs(row.id).map((w) => ({ file: w.file, title: w.title, kind: w.kind, size: w.size, addedAt: w.added_at, url: `/api/walkthroughs/${encodeURIComponent(w.file)}` })),
    status: row.status,
    build: row.build || null,
    // The game page is an iframe, which sends no header: this device's level rides along as a query.
    playUrl: row.status === 'installed' && row.build ? (isWebGame(row) ? deps.accounts.assetUrl(row) : playPath(row) + (viewer()?.device ? `?adult=${viewer()!.device}` : '')) : null,
    family: row.family || 'renpy',
    /** What made the game, for other engines ("HTML (SugarCube 2.36.1)"). */
    engineLabel: row.engine_label || null,
    version: release?.version || row.version || null,
    detectedVersion: row.version || null,
    renpyVersion: row.renpy_version || null,
    engine: row.engine || null,
    sizeBytes: row.size_bytes,
    fileCount: row.file_count,
    screen: row.screen_w ? ([row.screen_w, row.screen_h] as [number, number]) : null,
    saveDir: row.save_dir || null,
    source: { archive: source.archive ?? null, size: source.size ?? null },
    canReinstall: !!source.archive && (await exists(join(deps.cfg.archivesDir, cleanRelPath(source.archive)))),
    recipe: recipe
      ? {
          id: recipe.id,
          links: recipe.links ?? {},
          continuesFrom: recipe.continuesFrom ?? [],
          status: release?.status ?? null,
        }
      : row.recipe_id
        ? { id: row.recipe_id, links: {}, continuesFrom: [], status: null }
        : null,
    update: update ? { version: update.version, date: update.date ?? null, status: update.status, archives: update.archives.map((archive) => archive.name) } : null,
    favoriteAt: row.favorite_at || null,
    finishedAt: row.finished_at || null,
    playTime: row.play_time,
    /** The person's status: playing, stalled, dropped, finished, or null when not set. */
    playStatus: row.play_status || null,
    rating: row.rating || null,
    notNowAt: row.not_now_at || null,
    /** How the game plays on a phone, curated in the recipe: great, playable or desktop. */
    phone: recipe?.phone ?? null,
    latestSave,
    createdAt: row.created_at,
    installedAt: row.installed_at || null,
    lastPlayedAt: row.last_played_at || null,
    saves,
    mods: { files: mods.files + mods.deleted, hash: mods.hash, applied: isModBuildOf(row.build, mods.hash) },
    job: job ? { id: job.id, type: job.type, status: job.status, stage: job.stage, progress: job.progress } : null,
  }
}
