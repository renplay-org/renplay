import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Router } from 'express'
import { KEEP_DOWNLOADS, archiveIdentity, publishUpload } from './archives.js'
import { parseJson, type GameSource } from '../db.js'
import { INSPECT_VERSION, enqueueImport, existingGame, inspectArchive } from '../pipeline/import.js'
import type { Archive, ArchiveInfo, ArchivesResponse, InspectResponse, UploadStarted } from '../shared/api.js'
import { exists, newId } from '../util/fsx.js'
import { HttpError, cleanRelPath, isSlug, safeJoin } from '../util/paths.js'
import type { Services } from '../services.js'

const ARCHIVE_RE = /\.(zip|7z|rar|tar|tgz|tar\.(gz|bz2|xz|zst))$/i
const CHUNK = 32 << 20


async function listArchiveFiles(root: string): Promise<Array<{ rel: string; size: number; mtimeMs: number }>> {
  const out: Array<{ rel: string; size: number; mtimeMs: number }> = []
  async function walk(dir: string, depth: number) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory() && depth < 3) await walk(full, depth + 1)
      else if (e.isFile() && ARCHIVE_RE.test(e.name)) {
        const st = await stat(full)
        out.push({ rel: relative(root, full).split('\\').join('/'), size: st.size, mtimeMs: Math.floor(st.mtimeMs) })
      }
    }
  }
  await walk(root, 0)
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function createLibraryRouter(deps: Services): Router {
  const { cfg, db, jobs, catalog } = deps
  const router = Router({ caseSensitive: true, strict: true })

  // ---- archives -------------------------------------------------------------

  router.get('/archives', async (_req, res) => {
    const files = await listArchiveFiles(cfg.archivesDir)
    const installedBy = new Map<string, string>()
    // Off: the download of a hidden game is hidden too, also when no recipe names it.
    const hiddenSources = new Set<string>()
    for (const g of db.allGames()) {
      const s = parseJson<GameSource>(g.source, {})
      if (!s.archive) continue
      if (deps.content.hides(g)) hiddenSources.add(s.archive)
      else installedBy.set(s.archive, g.id)
    }
    const known = new Map(db.allArchives().map((a) => [a.path, a]))
    for (const k of known.keys()) if (!files.some((f) => f.rel === k)) db.deleteArchive(k)
    res.json({
      dir: cfg.archivesDir,
      archives: files.map((f): Archive | null => {
        const row = known.get(f.rel)
        const fresh = row && row.size === f.size && row.mtime_ms === f.mtimeMs
        const parsed = fresh ? parseJson<ArchiveInfo | null>(row.info, null) : null
        const info = parsed?.v === INSPECT_VERSION ? parsed : null
        const sha256 = fresh ? row.sha256 || null : null
        const match = catalog.match({ name: f.rel, size: f.size, sha256: sha256 ?? undefined })
        // Off: an adult game does not exist, so its download does not appear in Add games.
        if (match && deps.content.hidesRecipe(match.recipe.nsfw)) return null
        if (hiddenSources.has(f.rel) && !installedBy.has(f.rel)) return null
        const existing = existingGame(db, undefined, match?.recipe.id, info?.saveDir, info?.title)
        return {
          path: f.rel,
          name: basename(f.rel),
          size: f.size,
          mtime: f.mtimeMs,
          sha256,
          info,
          installedAs: installedBy.get(f.rel) ?? null,
          recipe: match
            ? {
                id: match.recipe.id,
                title: match.recipe.title,
                version: match.release?.version ?? null,
                status: match.release?.status ?? 'untested',
                exact: match.exact,
                art: catalog.recipeArt(match.recipe),
                nsfw: match.recipe.nsfw ?? false,
              }
            : null,
          existingGame: existing && !deps.content.hides(existing) ? existing.id : null,
        }
      }).filter((a) => a !== null),
    } satisfies ArchivesResponse)
  })

  router.post('/archives/inspect', async (req, res) => {
    const rel = cleanRelPath(req.body?.path)
    const full = safeJoin(cfg.archivesDir, rel)
    const st = await stat(full).catch(() => null)
    if (!st) throw new HttpError(404, 'Archive not found')
    if (catalog.archiveHidden(rel, st.size)) throw new HttpError(404, 'Archive not found')
    const info = await inspectArchive(full)
    const prev = db.getArchive(rel)
    db.upsertArchive({
      path: rel,
      size: st.size,
      mtime_ms: Math.floor(st.mtimeMs),
      sha256: prev && prev.size === st.size && prev.mtime_ms === Math.floor(st.mtimeMs) ? prev.sha256 : '',
      info: JSON.stringify(info),
    })
    const existing = existingGame(db, undefined, undefined, info.saveDir, info.title)
    res.json({ info, existingGame: existing && !deps.content.hides(existing) ? existing.id : null } satisfies InspectResponse)
  })

  router.post('/archives/hash', (req, res) => {
    const rel = cleanRelPath(req.body?.path)
    if (catalog.archiveHidden(rel)) throw new HttpError(404, 'Archive not found')
    res.json({ jobId: jobs.enqueue('hash-archive', '', { path: rel }) })
  })

  router.delete('/archives', async (req, res) => {
    const rel = cleanRelPath(req.query['path'])
    const full = safeJoin(cfg.archivesDir, rel)
    if (!(await exists(full)) || catalog.archiveHidden(rel)) throw new HttpError(404, 'Archive not found')
    await unlink(full)
    db.deleteArchive(rel)
    res.json({ ok: true })
  })

  // ---- imports ----------------------------------------------------------------

  router.post('/imports', async (req, res) => {
    const b = req.body ?? {}
    const source = b.source
    // Games come from the archives folder (copied there or uploaded). Download
    // links are not supported: file hosts tie them to the browser that made them.
    if (!source || source.kind !== 'archive') throw new HttpError(400, 'source must be {kind:"archive",path}')
    const rel = cleanRelPath(source.path)
    if (b.game !== undefined && b.game !== null && !isSlug(b.game)) throw new HttpError(400, 'Invalid game id')
    // `game` reinstalls into a game already in the library. Check it now: the install only gets
    // to it after unpacking, which takes an hour for a big game.
    if (b.game && (!db.getGame(b.game) || deps.content.hides(db.getGame(b.game)))) throw new HttpError(404, `Game ${b.game} is not in the library`)
    if (b.game && jobs.activeFor(b.game)) throw new HttpError(409, 'A job is already running for this game')
    // Off: an adult game does not exist, so its download cannot be installed either.
    {
      const st = await stat(safeJoin(cfg.archivesDir, rel)).catch(() => null)
      if ((st && catalog.archiveHidden(rel, st.size)) || (typeof b.recipeId === 'string' && catalog.isAdultId(b.recipeId) && deps.content.hidesRecipe(true))) throw new HttpError(404, 'Game not found')
    }
    const jobId = enqueueImport(jobs, {
      source,
      game: b.game || undefined,
      recipeId: typeof b.recipeId === 'string' ? b.recipeId : undefined,
      engine: typeof b.engine === 'string' ? b.engine : undefined,
      reapplyMods: !!b.reapplyMods,
    })
    res.json({ jobId })
  })

  // ---- chunked uploads into the archives folder -------------------------------

  const uploadMeta = (id: string) => join(cfg.uploadsDir, `${id}.json`)
  const uploadPart = (id: string) => join(cfg.uploadsDir, `${id}.part`)
  const readMeta = async (id: string): Promise<{ name: string; size: number }> => {
    if (!/^u[a-z0-9]+$/.test(id)) throw new HttpError(400, 'Invalid upload id')
    try {
      return JSON.parse(await readFile(uploadMeta(id), 'utf-8'))
    } catch {
      throw new HttpError(404, 'Upload not found')
    }
  }

  router.post('/uploads', async (req, res) => {
    const name = basename(String(req.body?.name ?? '')).replace(/[^\w.() -]+/g, '_').slice(0, 180)
    const size = Number(req.body?.size)
    if (!name || !ARCHIVE_RE.test(name)) throw new HttpError(400, 'Upload a .zip, .7z, .rar or .tar archive')
    if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, 'Invalid size')
    await mkdir(cfg.uploadsDir, { recursive: true })
    const id = newId('u')
    await writeFile(uploadMeta(id), JSON.stringify({ name, size }))
    await writeFile(uploadPart(id), '')
    res.json({ id, chunkSize: CHUNK, received: 0 } satisfies UploadStarted)
  })

  router.get('/uploads/:id', async (req, res) => {
    const meta = await readMeta(req.params.id)
    const st = await stat(uploadPart(req.params.id)).catch(() => null)
    res.json({ ...meta, received: st?.size ?? 0 })
  })

  router.put('/uploads/:id', async (req, res) => {
    const id = req.params.id
    const meta = await readMeta(id)
    const offset = Number(req.query['offset'])
    const st = await stat(uploadPart(id))
    if (offset !== st.size) {
      res.status(409).json({ error: 'Offset mismatch', received: st.size })
      return
    }
    const len = Number(req.header('content-length'))
    if (!Number.isFinite(len) || len > CHUNK + 1024 || offset + len > meta.size) throw new HttpError(400, 'Invalid chunk')
    await pipeline(req, createWriteStream(uploadPart(id), { flags: 'r+', start: offset }))
    const after = await stat(uploadPart(id))
    res.json({ received: after.size })
  })

  router.post('/uploads/:id/complete', async (req, res) => {
    const id = req.params.id
    const meta = await readMeta(id)
    const st = await stat(uploadPart(id))
    if (st.size !== meta.size) throw new HttpError(409, `Upload incomplete (${st.size} of ${meta.size} bytes)`)
    await mkdir(cfg.archivesDir, { recursive: true })
    let dest = join(cfg.archivesDir, meta.name)
    let i = 1
    while (await exists(dest)) dest = join(cfg.archivesDir, meta.name.replace(/(\.[^.]+)?$/, `-${++i}$1`))
    await publishUpload(uploadPart(id), dest)
    db.markUploadedArchive(relative(cfg.archivesDir, dest), archiveIdentity(await stat(dest)))
    await unlink(uploadMeta(id)).catch(() => {})
    res.json({ path: relative(cfg.archivesDir, dest) })
  })

  router.delete('/uploads/:id', async (req, res) => {
    await readMeta(req.params.id)
    await rm(uploadPart(req.params.id), { force: true })
    await rm(uploadMeta(req.params.id), { force: true })
    res.json({ ok: true })
  })

  // ---- catalog --------------------------------------------------------------

  router.put('/system/downloads', (req, res) => {
    if (cfg.keepDownloadsLocked) throw new HttpError(409, 'Download retention is set by the server configuration')
    if (typeof req.body?.keepDownloads !== 'boolean') throw new HttpError(400, 'Keep downloads must be a boolean')
    db.setSetting(KEEP_DOWNLOADS, req.body.keepDownloads)
    res.json({ ok: true })
  })

  return router
}
