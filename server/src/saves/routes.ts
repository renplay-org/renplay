import express, { Router, type Request } from 'express'
import { readFile } from 'node:fs/promises'
import { saveImport } from './import-upload.js'
import type { GameRow } from '../db.js'
import { readSaveScreenshot, readZipEntries, slotInfo } from './savefile.js'
import { cachedSaveMeta, cachedSceneHash } from './cache.js'
import { createSavesImportRouter } from './import-routes.js'
import { SHARED_DIRS } from './store.js'
import type { Services } from '../services.js'
import { SYNC_SETTING, downloadSync, syncCodesOn, uploadSync } from './sync.js'
import { dirSize, sha1 } from '../util/fsx.js'
import { HttpError, assertSlug, cleanRelPath, isSaveDirName } from '../util/paths.js'


/** A person's saves of one game, at /api/saves/<game>. */
function gameSaves(s: Services): Router {
  const { db, content, saveStores } = s
  const { syncServer, saveLimits: limits } = s.cfg
  const router = Router({ caseSensitive: true, strict: true })
  const me = () => s.accounts.current().id
  // What each person's saves and their history take, counted again at most every 5 seconds.
  const used = new Map<string, { at: number; size: Promise<{ bytes: number; files: number }> }>()
  const usedSize = () => {
    const store = s.saves
    let u = used.get(store.root)
    if (!u || Date.now() - u.at > 5000) {
      u = { at: Date.now(), size: Promise.all([dirSize(store.root), dirSize(store.historyRoot)]).then(([a, b]) => ({ bytes: a.bytes + b.bytes, files: a.files + b.files })) }
      used.set(store.root, u)
    }
    return u.size
  }

  const game = (req: Request): GameRow => content.game(req.params.id)
  const allowedDir = (dir: string): boolean => {
    if (dir === 'tokens' || dir === 'persistent') return true
    const games = db.allGames().filter((g) => g.save_dir === dir)
    // Restricted users may not discover an unclassified folder through another game's runtime.
    return games.length ? games.some((g) => !content.hides(g)) : !content.hides({ adult: 0, recipe_id: '' })
  }

  const requireSaveDir = (g: GameRow): string => {
    if (!g.save_dir) throw new HttpError(409, 'The save folder of this game is not known yet. Start the game once, or set it in the game settings.')
    return g.save_dir
  }

  /**
   * Everything the in-game runtime needs before Ren'Py starts. ~/.renpy is one
   * central tree shared by all games, like on desktop: this game's save folder
   * and the shared folders come with their contents, every other folder only
   * as a listing (the runtime fetches those files if a game opens them).
   */
  router.get('/:id/boot', async (req, res) => {
    const g = game(req)
    const files: Array<{ path: string; data: string; mtime: number }> = []
    const lazy: Array<{ path: string; size: number; mtime: number }> = []
    if (g.save_dir) {
      for (const f of await s.saves.list(g.save_dir)) {
        files.push({ path: `${g.save_dir}/${f.name}`, data: (await s.saves.read(g.save_dir, f.name)).toString('base64'), mtime: f.mtimeMs })
      }
    }
    for (const t of await s.saves.sharedFiles()) files.push({ path: t.name, data: t.data.toString('base64'), mtime: t.mtimeMs })
    for (const dir of await s.saves.listDirs()) {
      if (dir === g.save_dir || !allowedDir(dir)) continue
      for (const f of await s.saves.list(dir)) lazy.push({ path: `${dir}/${f.name}`, size: f.size, mtime: f.mtimeMs })
    }
    res.setHeader('Cache-Control', 'no-store')
    res.json({ saveDir: g.save_dir || null, files, lazy, serverTime: Date.now() })
  })

  /**
   * Resolves a ~/.renpy-relative path to (folder, name). Any folder is allowed:
   * games read and write each other's folders like on desktop. The game's own
   * folder is only learned from config.save_directory (POST /save-dir), never
   * guessed from paths, since a write may belong to another game's folder.
   */
  const resolvePath = (_g: GameRow, raw: unknown): { dir: string; name: string } => {
    const rel = cleanRelPath(raw)
    const slash = rel.indexOf('/')
    if (slash === -1) throw new HttpError(400, 'Path must be inside a save folder')
    const top = rel.slice(0, slash)
    const name = rel.slice(slash + 1)
    if (!allowedDir(top)) throw new HttpError(404, 'Save folder not found')
    if (!isSaveDirName(top)) throw new HttpError(400, 'Invalid save folder')
    return { dir: top, name }
  }

  /** Raw read of any file in the central tree (lazy files in the runtime). */
  router.get('/:id/raw', async (req, res) => {
    game(req)
    const rel = cleanRelPath(req.query['path'])
    const slash = rel.indexOf('/')
    if (slash === -1) throw new HttpError(400, 'Invalid path')
    if (!allowedDir(rel.slice(0, slash))) throw new HttpError(404, 'Save folder not found')
    const data = await s.saves.read(rel.slice(0, slash), rel.slice(slash + 1))
    res.setHeader('Cache-Control', 'no-store')
    // The version sent, so a device that loads it knows what it saw.
    res.setHeader('X-Renplay-Mtime', String((await s.saves.stat(rel.slice(0, slash), rel.slice(slash + 1)))?.mtimeMs ?? 0))
    res.type('application/octet-stream').send(data)
  })

  // The body is refused while it arrives once it passes the limit, never held whole in memory.
  router.put('/:id/file', express.raw({ type: () => true, limit: limits.file }), async (req, res) => {
    const g = game(req)
    const { dir, name } = resolvePath(g, req.query['path'])
    const body = req.body as Buffer
    if (!Buffer.isBuffer(body)) throw new HttpError(400, 'Expected a binary body')
    if (body.length > limits.file) throw new HttpError(413, `A save here can be at most ${Math.round(limits.file / (1 << 20))} MB`)
    if (Number.isFinite(limits.total)) {
      const size = await usedSize()
      if (size.bytes + body.length > limits.total || size.files >= limits.files) throw new HttpError(507, 'The saves here are full until the next fresh start')
    }
    const mtime = Number(req.header('x-mtime')) || undefined
    // The version the device last saw, for the conflict rule. Older runtimes send none.
    const rawBase = req.header('x-base')
    const base = rawBase !== undefined && /^\d+$/.test(rawBase) ? Number(rawBase) : undefined
    const rawUnanswered = req.header('x-unanswered')
    const unanswered = rawUnanswered && /^[0-9a-f]{1,8}:\d{1,9}$/.test(rawUnanswered) ? rawUnanswered : undefined
    const f = await s.saves.write(dir, name, body, { mtimeMs: mtime, reason: 'game', base, unanswered })
    res.json({ ok: true, size: f.size, mtime: f.mtimeMs, sha1: sha1(body), ...(f.conflict ? { conflict: f.conflict } : {}) })
  })

  router.delete('/:id/file', async (req, res) => {
    const g = game(req)
    const { dir, name } = resolvePath(g, req.query['path'])
    const rawBase = req.header('x-base')
    const base = rawBase !== undefined && /^\d+$/.test(rawBase) ? Number(rawBase) : undefined
    const removed = await s.saves.remove(dir, name, 'game-delete', base)
    // Another device saved it since this one last saw it: the save stays, and the device loads it.
    if (removed === 'changed') {
      res.status(409).json({ conflict: 'kept', mtime: (await s.saves.stat(dir, name))?.mtimeMs ?? 0 })
      return
    }
    if (removed && name.endsWith('.save') && !name.includes('/')) saveStores.dropNote(me(), dir, name)
    res.json({ ok: true })
  })

  /** Reported by the runtime after Ren'Py starts (config.save_directory). */
  router.post('/:id/save-dir', async (req, res) => {
    const g = game(req)
    const sd = req.body?.saveDir
    if (!isSaveDirName(sd) || sd === 'tokens' || sd === 'persistent') throw new HttpError(400, 'Invalid save folder')
    if (sd !== g.save_dir) {
      // Reporting a folder must not relabel a hidden game's (or an orphaned) saves as safe.
      const existing = db.allGames().filter((other) => other.id !== g.id && other.save_dir === sd)
      if (existing.some((other) => content.hides(other)) || (!existing.length && !allowedDir(sd) && (await s.saves.list(sd)).length)) throw new HttpError(404, 'Save folder not found')
    }
    let changed = false
    if (g.save_dir !== sd) {
      db.updateGame(g.id, { save_dir: sd })
      changed = true
    }
    const screen = req.body?.screen
    if (Array.isArray(screen) && screen.length === 2 && screen.every((n: unknown) => Number.isInteger(n) && (n as number) > 0 && (n as number) < 20000)) {
      if (g.screen_w !== screen[0] || g.screen_h !== screen[1]) db.updateGame(g.id, { screen_w: screen[0], screen_h: screen[1] })
    }
    res.json({ ok: true, changed, saveDir: changed ? sd : g.save_dir })
  })

  /** Save slots with metadata for the save browser. */
  router.get('/:id', async (req, res) => {
    const g = game(req)
    if (!g.save_dir) {
      res.json({ saveDir: null, slots: [], other: [], conflicts: [] })
      return
    }
    const files = await s.saves.list(g.save_dir)
    const notes = saveStores.notes(me(), g.save_dir)
    const slots = []
    const other = []
    for (const f of files) {
      if (!f.name.endsWith('.save') || f.name.includes('/')) {
        other.push({ name: f.name, size: f.size, mtime: f.mtimeMs })
        continue
      }
      const info = slotInfo(f.name)
      const meta = await cachedSaveMeta(s.saves, g.save_dir, f)
      slots.push({
        file: f.name,
        size: f.size,
        mtime: f.mtimeMs,
        kind: info.kind,
        label: info.label,
        page: info.page,
        slot: info.slot,
        name: meta?.name ?? '',
        ctime: meta?.ctime ? meta.ctime * 1000 : f.mtimeMs,
        renpyVersion: meta?.renpyVersion,
        gameVersion: meta?.gameVersion,
        runtime: meta?.runtime,
        // Blurred: the save's picture is the adult game's art and never leaves the server.
        screenshot: meta?.hasScreenshot && !content.blurs(g) ? `/api/saves/${g.id}/screenshot?user=${me()}&file=${encodeURIComponent(f.name)}&v=${f.mtimeMs}` : null,
        screenshotHash: meta?.hasScreenshot && content.blurs(g) ? await cachedSceneHash(s.saves, g.save_dir, f) : null,
        valid: !!meta,
        title: notes.get(f.name)?.title || null,
        note: notes.get(f.name)?.note || null,
        pinnedAt: notes.get(f.name)?.pinned_at || null,
      })
    }
    slots.sort((a, b) => b.ctime - a.ctime)
    // Second versions the conflict rule kept in History during the last two weeks.
    const conflicts = await s.saves.conflicts(g.save_dir, Date.now() - 14 * 24 * 3600_000)
    res.json({ saveDir: g.save_dir, slots, other, conflicts, sync: g.family === 'renpy' && syncCodesOn(db) })
  })

  // ---- Ren'Py Sync codes ------------------------------------------------------

  const syncGame = (req: Request): string => {
    const g = game(req)
    if (!syncCodesOn(db)) throw new HttpError(409, 'Sync codes are off. An admin can turn them on in Settings.')
    if (g.family !== 'renpy') throw new HttpError(409, 'Sync codes are for Ren’Py games.')
    return requireSaveDir(g)
  }

  /** Sends this person's saves of the game to Ren'Py's sync server and returns the code. */
  router.post('/:id/sync', async (req, res) => {
    res.json(await uploadSync(syncServer, s.saves, syncGame(req), typeof req.body?.tz === 'string' ? req.body.tz : undefined))
  })

  /** Fetches the saves for a code made on another device. */
  router.post('/:id/sync/download', async (req, res) => {
    res.json(await downloadSync(syncServer, s.saves, syncGame(req), req.body?.code))
  })

  /** A save's name, note and pin for this person. The save file itself is not touched. */
  router.put('/:id/meta', (req, res) => {
    const g = game(req)
    const saveDir = requireSaveDir(g)
    const file = cleanRelPath(req.query['file'])
    if (!file.endsWith('.save') || file.includes('/')) throw new HttpError(400, 'Choose a save file')
    const b = req.body ?? {}
    for (const [key, max] of [['title', 80], ['note', 500]] as const) {
      if (b[key] !== undefined && (typeof b[key] !== 'string' || b[key].length > max)) throw new HttpError(400, `The ${key === 'title' ? 'name' : 'note'} is text of up to ${max} characters`)
    }
    if (b.pinned !== undefined && typeof b.pinned !== 'boolean') throw new HttpError(400, 'Pinned must be true or false')
    const user = me()
    const row = saveStores.note(user, saveDir, file)
    const next = {
      title: b.title !== undefined ? b.title.trim() : row.title,
      note: b.note !== undefined ? b.note.trim() : row.note,
      pinned_at: b.pinned === undefined ? row.pinned_at : b.pinned ? row.pinned_at || new Date().toISOString() : '',
    }
    saveStores.setNote(user, saveDir, file, next)
    res.json({ ok: true, title: next.title || null, note: next.note || null, pinnedAt: next.pinned_at || null })
  })

  router.get('/:id/screenshot', async (req, res) => {
    const g = game(req)
    if (content.blurs(g)) throw new HttpError(404, 'No screenshot')
    const name = cleanRelPath(req.query['file'])
    const png = await readSaveScreenshot(await s.saves.read(requireSaveDir(g), name))
    if (!png) throw new HttpError(404, 'No screenshot')
    if (req.query['user'] !== undefined && req.query['user'] !== String(me())) throw new HttpError(404, 'Screenshot not found')
    res.setHeader('Cache-Control', 'private, no-store')
    res.type('png').send(png)
  })

  router.get('/:id/download', async (req, res) => {
    const g = game(req)
    const name = cleanRelPath(req.query['file'])
    const data = await s.saves.read(requireSaveDir(g), name)
    res.attachment(name.split('/').pop()!)
    res.type('application/octet-stream').send(data)
  })

  router.delete('/:id/slot', async (req, res) => {
    const g = game(req)
    const file = cleanRelPath(req.query['file'])
    const ok = await s.saves.remove(requireSaveDir(g), file, 'user-delete')
    if (!ok) throw new HttpError(404, 'Save not found')
    saveStores.dropNote(me(), requireSaveDir(g), file)
    res.json({ ok: true })
  })

  router.get('/:id/export', async (req, res) => {
    const g = game(req)
    const dir = requireSaveDir(g)
    res.attachment(`${g.id}-saves-${new Date().toISOString().slice(0, 10)}.zip`)
    res.type('application/zip')
    await s.saves.exportZip([dir], res, { includeTokens: req.query['tokens'] === '1' })
  })

  router.post('/:id/import', saveImport('files', async (req, res) => {
    const g = game(req)
    const dir = requireSaveDir(g)
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (!files.length) throw new HttpError(400, 'No files uploaded')
    // Process one bounded file at a time, never materialize the multipart request in memory.
    const report = { imported: [] as string[], skipped: [] as Array<{ name: string; reason: string }>, trustedKeys: 0 }
    for (const f of files) {
      const part = await s.saves.importFiles(dir, [{ filename: Buffer.from(f.originalname, 'latin1').toString('utf-8'), data: await readFile(f.path) }])
      report.imported.push(...part.imported); report.skipped.push(...part.skipped); report.trustedKeys += part.trustedKeys
    }
    res.json(report)
  }))

  /** Copies a save to another game (e.g. carry the end of season 1 into season 2). */
  router.post('/:id/copy', async (req, res) => {
    const g = game(req)
    const target = db.getGame(assertSlug(req.body?.target))
    if (!target || content.hides(target)) throw new HttpError(404, 'Target game not found')
    const toDir = requireSaveDir(target)
    const name = await s.saves.copySave(requireSaveDir(g), cleanRelPath(req.body?.file), toDir)
    res.json({ ok: true, file: name, target: target.id })
  })

  router.get('/:id/history', async (req, res) => {
    const g = game(req)
    const name = typeof req.query['file'] === 'string' ? cleanRelPath(req.query['file']) : undefined
    res.json({ versions: await s.saves.history(requireSaveDir(g), name) })
  })

  router.post('/:id/history/restore', async (req, res) => {
    const g = game(req)
    const id = req.body?.id
    if (typeof id !== 'string') throw new HttpError(400, 'Missing version id')
    const f = await s.saves.restoreVersion(requireSaveDir(g), id)
    res.json({ ok: true, file: f })
  })

  return router
}

/**
 * Every saves route: a person's saves of each game, the guided import and the export of all of
 * them, an admin's copy, export and import of a person's saves, sync codes and the save backups.
 */
export function createSavesRouter(s: Services): Router {
  const { db, content, saveStores, backups } = s
  const router = Router({ caseSensitive: true, strict: true })
  router.use('/saves', gameSaves(s))
  router.use('/saves-import', createSavesImportRouter(s))

  /** All save folders (including ones without a game) as one zip. */
  router.get('/saves-export', async (_req, res) => {
    const store = s.saves
    // The export is of what this person may see. Hidden games' saves stay where they are.
    const dirs = new Set(content.visibleSaveDirs([...await store.listDirs(), ...db.allGames().map((g) => g.save_dir).filter(Boolean)]))
    res.attachment(`renplay-saves-${new Date().toISOString().slice(0, 10)}.zip`)
    res.type('application/zip')
    await store.exportZip([...dirs], res, { includeTokens: true })
  })

  // An admin's actions on a person's saves. The copy takes what the admin may see.
  router.post('/users/:id/saves/copy', async (req, res) => {
    const from = Number(req.params.id), to = Number(req.body?.target), game = req.body?.game
    let dirs: string[]
    if (game) {
      const g = db.getGame(game)
      if (!g?.save_dir || content.hides(g)) throw new HttpError(404, 'Game save folder not found')
      dirs = [g.save_dir, 'tokens']
    } else {
      dirs = [...content.visibleSaveDirs(await saveStores.of(from).listDirs()), ...SHARED_DIRS]
    }
    res.json({ copied: await saveStores.copy(from, to, dirs) })
  })
  router.get('/users/:id/saves/export', async (req, res) => {
    const id = Number(req.params.id), store = saveStores.of(id)
    res.attachment(`renplay-user-${id}-saves.zip`).type('application/zip')
    await store.exportZip(content.visibleSaveDirs(await store.listDirs()), res, { includeTokens: true })
  })
  router.post('/users/:id/saves/import', saveImport('file', async (req, res) => {
    const target = saveStores.of(Number(req.params.id))
    if (!req.file) throw new HttpError(400, 'Upload a save folder zip')
    const entries = await readZipEntries(req.file.path, () => true, 128 << 20)
    const files = [...entries].map(([path, data]) => {
      const rel = cleanRelPath(path), slash = rel.indexOf('/'), dir = rel.slice(0, slash)
      if (slash < 1 || !isSaveDirName(dir)) throw new HttpError(400, 'Zip entries must be inside save folders')
      return { dir, file: rel.slice(slash + 1), data }
    })
    for (const f of files) {
      if (f.dir === 'tokens' && f.file === 'security_keys.txt') await target.mergeSecurityKeys(f.data.toString('utf-8'))
      else await target.write(f.dir, f.file, f.data, { reason: 'user-import' })
    }
    res.json({ imported: files.length })
  }))

  router.put('/system/sync', (req, res) => {
    if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'Expected { on: true or false }')
    db.setSetting(SYNC_SETTING, req.body.on)
    res.json({ on: req.body.on })
  })

  router.get('/system/backups', async (_req, res) => {
    res.json(await backups.info())
  })
  router.post('/system/backups', async (_req, res) => {
    if (!backups.dir) throw new HttpError(409, 'Save backups are off. Set RENPLAY_BACKUP_DIR to a folder to turn them on.')
    const name = await backups.run()
    res.json({ ok: true, name, ...(await backups.info()) })
  })
  router.get('/system/backups/:name', (req, res, next) => {
    const path = backups.path(req.params.name)
    if (!path) throw new HttpError(404, 'Backup not found')
    res.download(path, req.params.name, (err) => err && next(new HttpError(404, 'Backup not found')))
  })

  return router
}
