import express, { Router, type Request } from 'express'
import multer from 'multer'
import type { Builds } from '../builds.js'
import type { ContentMode } from '../content.js'
import type { Db, GameRow } from '../db.js'
import type { JobManager } from '../jobs.js'
import { Overlays } from '../mods.js'
import { baseFiles, readBaseFile } from '../pipeline/applymods.js'
import { isZip, readZipEntries } from '../saves/savefile.js'
import { HttpError, assertSlug, cleanRelPath } from '../util/paths.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 256 << 20, files: 500 } })
const TEXT_EXT = /\.(rpy|rpym|txt|json|py|ini|cfg|md|csv|xml|ya?ml|log|tl|html|css|js)$/i

type BaseIndex = Map<string, { size: number; where: 'zip' | 'pack' }>

/** Pictures and videos of a game, which the file browser does not send below Shown. */
const PICTURE_EXT = /\.(?:jpe?g|png|webp|gif|avif|bmp|tga|svg|mp4|webm|ogv|mkv|avi|mov|m4v)$/i

export function createFilesRouter(db: Db, builds: Builds, overlays: Overlays, jobs: JobManager, content: ContentMode): Router {
  const router = Router({ caseSensitive: true, strict: true })
  const cache = new Map<string, { key: string; files: BaseIndex }>()

  const game = (req: Request): GameRow => {
    const g = db.getGame(assertSlug(req.params.id))
    if (!g || content.hides(g)) throw new HttpError(404, 'Game not found')
    if (g.status !== 'installed') throw new HttpError(409, 'Install the game to browse its files')
    if (g.family && g.family !== 'renpy') throw new HttpError(409, 'Files and mods are for Ren’Py games')
    return g
  }

  const base = async (g: GameRow): Promise<BaseIndex> => {
    const key = g.build.split('.m')[0]!
    const c = cache.get(g.id)
    if (c && c.key === key) return c.files
    const files = await baseFiles(builds, g.id, g.build)
    cache.set(g.id, { key, files })
    return files
  }

  router.get('/:id/files', async (req, res) => {
    const g = game(req)
    const dir = cleanRelPath(req.query['dir'] ?? 'game', { allowEmpty: true }) || 'game'
    const prefix = dir + '/'
    const files = await base(g)
    const ov = await overlays.list(g.id)
    const added = new Map(ov.files.map((f) => [f.path, f]))
    const deleted = new Set(ov.deleted)
    const dirs = new Map<string, { count: number; changed: boolean }>()
    const entries: Array<{ name: string; path: string; type: 'file'; size: number; state: string; text: boolean }> = []
    const consider = (path: string, size: number, state: string) => {
      if (!path.startsWith(prefix)) return
      const rest = path.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash !== -1) {
        const name = rest.slice(0, slash)
        const d = dirs.get(name) ?? { count: 0, changed: false }
        d.count++
        if (state !== 'base') d.changed = true
        dirs.set(name, d)
      } else entries.push({ name: rest, path, type: 'file', size, state, text: TEXT_EXT.test(rest) })
    }
    for (const [path, info] of files) {
      if (added.has(path)) consider(path, added.get(path)!.size, 'modified')
      else if (deleted.has(path)) consider(path, info.size, 'deleted')
      else consider(path, info.size, 'base')
    }
    for (const [path, f] of added) if (!files.has(path)) consider(path, f.size, 'added')
    const summary = await overlays.summary(g.id)
    res.json({
      dir,
      dirs: [...dirs].map(([name, d]) => ({ name, path: `${prefix}${name}`, type: 'dir', count: d.count, changed: d.changed })).sort((a, b) => a.name.localeCompare(b.name)),
      files: entries.sort((a, b) => a.name.localeCompare(b.name)),
      mods: { ...summary, applied: g.build.endsWith(`.m${summary.hash}`) || (!summary.hash && !g.build.includes('.m')), job: jobs.activeFor(g.id)?.type === 'apply-mods' },
    })
  })

  router.get('/:id/files/raw', async (req, res) => {
    const g = game(req)
    const path = Overlays.editablePath(req.query['path'])
    // Blurred: the game plays, but its pictures and videos are not sent on their own.
    if (content.blurs(g) && PICTURE_EXT.test(path)) throw new HttpError(404, 'File not found')
    const data = (await overlays.read(g.id, path)) ?? (await readBaseFile(builds, g.id, g.build, path))
    if (!data) throw new HttpError(404, 'File not found')
    if (req.query['download'] === '1') res.attachment(path.split('/').pop()!)
    res.setHeader('Cache-Control', 'no-store')
    res.type(TEXT_EXT.test(path) ? 'text/plain; charset=utf-8' : 'application/octet-stream').send(data)
  })

  router.put('/:id/files/raw', express.raw({ type: () => true, limit: '256mb' }), async (req, res) => {
    const g = game(req)
    const path = Overlays.editablePath(req.query['path'])
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Expected file content')
    await overlays.write(g.id, path, req.body)
    res.json({ ok: true })
  })

  router.delete('/:id/files/raw', async (req, res) => {
    const g = game(req)
    const path = Overlays.editablePath(req.query['path'])
    const files = await base(g)
    await overlays.remove(g.id, path, files.has(path))
    res.json({ ok: true })
  })

  router.post('/:id/files/revert', async (req, res) => {
    const g = game(req)
    await overlays.revert(g.id, Overlays.editablePath(req.body?.path))
    res.json({ ok: true })
  })

  /**
   * Adds files to the overlay. Plain files go into `dir`; zip files are
   * unpacked there (a top-level "game/" folder in the zip is honoured).
   */
  router.post('/:id/files/upload', upload.array('files'), async (req, res) => {
    const g = game(req)
    const dir = Overlays.editablePath(req.body?.dir || 'game')
    const relPaths: string[] = (() => {
      try {
        return JSON.parse(req.body?.paths ?? '[]')
      } catch {
        return []
      }
    })()
    const written: string[] = []
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!
      const name = Buffer.from(f.originalname, 'latin1').toString('utf-8')
      if (req.body?.extract !== '0' && /\.zip$/i.test(name) && isZip(f.buffer)) {
        const entries = await readZipEntries(f.buffer, () => true, 1 << 30)
        const names = [...entries.keys()].filter((n) => !n.endsWith('/') && !n.includes('__MACOSX'))
        // Mods are usually shipped as "game/..." or with a single wrapping folder.
        const gameRooted = names.every((n) => n.startsWith('game/'))
        const single = !gameRooted && new Set(names.map((n) => n.split('/')[0])).size === 1 && names.every((n) => n.includes('/'))
        for (const n of names) {
          let rel = n
          if (gameRooted) rel = n
          else {
            if (single) rel = n.slice(n.indexOf('/') + 1)
            const inner = rel.indexOf('game/')
            rel = inner === 0 ? rel : `${dir}/${rel}`
          }
          const path = Overlays.editablePath(rel)
          await overlays.write(g.id, path, entries.get(n)!)
          written.push(path)
        }
        continue
      }
      const rel = relPaths[i] ? cleanRelPath(relPaths[i]) : name
      const path = Overlays.editablePath(`${dir}/${rel}`)
      await overlays.write(g.id, path, f.buffer)
      written.push(path)
    }
    res.json({ ok: true, written })
  })

  router.post('/:id/files/apply', (req, res) => {
    const g = game(req)
    if (jobs.activeFor(g.id)) throw new HttpError(409, 'A job is already running for this game')
    res.json({ jobId: jobs.enqueue('apply-mods', g.id, { game: g.id }) })
  })

  /** Drops all mods (moved aside, not deleted) and restores the original files. */
  router.post('/:id/files/reset', async (req, res) => {
    const g = game(req)
    if (jobs.activeFor(g.id)) throw new HttpError(409, 'A job is already running for this game')
    await overlays.archive(g.id)
    res.json({ jobId: jobs.enqueue('apply-mods', g.id, { game: g.id }) })
  })

  return router
}
