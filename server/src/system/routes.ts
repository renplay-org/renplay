import { SYNC_SETTING, syncCodesOn } from '../saves/sync.js'
import { KEEP_DOWNLOADS, keepDownloads } from '../library/archives.js'
import { readdir, stat, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { Router } from 'express'
import { parseJson } from '../db.js'
import { cleanRelPath, safeJoin } from '../util/paths.js'
import { dirSize } from '../util/fsx.js'
import type { Services } from '../services.js'

async function disk(path: string) {
  try {
    const s = await statfs(path)
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }
  } catch {
    return null
  }
}

/** Variables whose effect Settings shows, so it can say whether the server sets them. */
const PROVENANCE = ['RENPLAY_AUTH', 'GAMES_DIR', 'ARCHIVES_DIR', 'DATA_DIR', 'RENPLAY_BACKUP_DIR', 'RENPLAY_CATALOG_URLS', 'RENPLAY_RECIPES_DIR', 'RENPLAY_LOG_LEVEL', 'RENPLAY_SYNC_SERVER', 'RENPLAY_ENGINES_URL']

export function createSystemRouter(s: Services): Router {
  const { cfg, db, jobs, engines, builds, purger, version, content, catalog } = s
  const router = Router({ caseSensitive: true, strict: true })

  router.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime(), version })
  })

  /**
   * Held open by the job runner (through the scale-to-zero proxy) to keep the
   * pod alive. Headers go out immediately: proxies give up on responses whose
   * headers take longer than their header timeout, but stream bodies fine.
   */
  // ---- storage -----------------------------------------------------------------

  /**
   * What uses space, game by game (the build played, other builds such as mods, the download), the
   * engines, and folders of no game, with what could be freed. Counted at most once a minute.
   */
  let storage: { at: number; body: unknown; level: string } | null = null
  // One count at a time for each level: a second request waits for the one running.
  let counting: { level: string; body: Promise<unknown> } | null = null
  router.get('/system/storage', async (_req, res) => {
    const level = content.viewerLevel()
    if (storage && storage.level === level && Date.now() - storage.at < 60_000) {
      res.json(storage.body)
      return
    }
    if (counting?.level !== level) {
      const body = countStorage().finally(() => {
        if (counting?.body === body) counting = null
      })
      counting = { level, body }
    }
    const body = await counting.body
    storage = { at: Date.now(), body, level }
    res.json(body)
  })
  const archiveAt = (archive: string) => {
    try {
      return safeJoin(cfg.archivesDir, cleanRelPath(archive))
    } catch {
      return null
    }
  }
  async function countStorage() {
    const games = []
    for (const g of db.allGames().filter((x) => !content.hides(x))) {
      const folders = await readdir(join(cfg.gamesDir, g.id), { withFileTypes: true }).catch(() => [])
      const builds = []
      for (const f of folders.filter((d) => d.isDirectory())) builds.push({ name: f.name, current: f.name === g.build, bytes: (await dirSize(join(cfg.gamesDir, g.id, f.name))).bytes })
      const archive = parseJson<{ archive?: string }>(g.source, {}).archive
      const at = archive ? archiveAt(archive) : null
      const st = at ? await stat(at).catch(() => null) : null
      const download = st?.isFile() ? { name: archive!, bytes: st.size } : null
      const buildBytes = builds.reduce((n, b) => n + b.bytes, 0)
      games.push({ id: g.id, title: catalog.recipe(g.recipe_id)?.title || g.title, status: g.status, builds, download, bytes: buildBytes + (download?.bytes ?? 0) })
    }
    games.sort((a, b) => b.bytes - a.bytes)
    const installed = await engines.installed()
    const used = new Set(db.allGames().filter((g) => g.status === 'installed' && g.engine).map((g) => g.engine))
    const { orphans } = await builds.verify()
    const orphanSizes = []
    for (const name of orphans) orphanSizes.push({ name, bytes: (await dirSize(join(cfg.gamesDir, name))).bytes })
    const enginesOut = installed.map((e) => ({ version: e.version, bytes: e.bytes, used: used.has(e.version) }))
    const body = {
      games,
      engines: enginesOut,
      orphans: orphanSizes,
      totals: {
        builds: games.reduce((n, g) => n + g.builds.reduce((m, b) => m + b.bytes, 0), 0),
        downloads: games.reduce((n, g) => n + (g.download?.bytes ?? 0), 0),
        engines: enginesOut.reduce((n, e) => n + e.bytes, 0),
      },
      // What Renplay can free: downloads of installed games (they can be added again), engines no game
      // uses. Folders of no game are listed, never deleted by Renplay.
      freeable: {
        downloads: games.filter((g) => g.status === 'installed').reduce((n, g) => n + (g.download?.bytes ?? 0), 0),
        engines: enginesOut.filter((e) => !e.used).reduce((n, e) => n + e.bytes, 0),
      },
    }
    return body
  }

  router.post('/system/storage/refresh', (_req, res) => {
    storage = null
    counting = null
    res.json({ ok: true })
  })

  router.get('/system', async (_req, res) => {
    const games = db.allGames().filter((g) => !content.hides(g))
    const used = new Map<string, string[]>()
    for (const g of games) if (g.engine && g.status === 'installed') used.set(g.engine, [...(used.get(g.engine) ?? []), g.title])
    const installed = await engines.installed()
    const available = await engines.available().catch(() => [])
    const { orphans } = await builds.verify()
    res.json({
      version,
      sync: { on: syncCodesOn(db), server: cfg.syncServer, chosen: db.getSetting<unknown>(SYNC_SETTING, null) !== null },
      // Where each value comes from: a variable on the server, or the default. No values of secrets.
      setBy: Object.fromEntries(PROVENANCE.map((name) => [name, process.env[name]?.trim() ? 'server' : 'default'])),
      keepDownloadsChosen: db.getSetting<unknown>(KEEP_DOWNLOADS, null) !== null,
      engines: {
        installed: installed.map((e) => ({ ...e, usedBy: used.get(e.version) ?? [] })),
        available: available.map((e) => ({ version: e.version, renpy: e.renpy, bytes: Object.values(e.files).reduce((n, f) => n + f.size, 0) })),
        index: cfg.enginesUrl,
      },
      disk: { games: await disk(cfg.gamesDir), data: await disk(cfg.dataDir) },
      library: {
        games: games.length,
        installed: games.filter((g) => g.status === 'installed').length,
        bytes: games.reduce((n, g) => n + (g.size_bytes || 0), 0),
      },
      orphans,
      purging: purger.pending(),
      paths: { games: cfg.gamesDir, archives: cfg.archivesDir, data: cfg.dataDir },
      deleteArchives: !keepDownloads(cfg, db),
      keepDownloads: keepDownloads(cfg, db),
      keepDownloadsLocked: cfg.keepDownloadsLocked,
      busy: jobs.isBusy(),
    })
  })

  /** Removes engines no installed game uses. */
  router.post('/system/prune', async (_req, res) => {
    const used = new Set(db.allGames().filter((g) => g.status === 'installed' && g.engine).map((g) => g.engine))
    res.json({ removed: await engines.prune(used) })
  })

  router.post('/system/engines/refresh', async (_req, res) => {
    res.json({ engines: (await engines.available(true)).map((e) => e.version) })
  })

  return router
}
