import { Router } from 'express'
import { readFile } from 'node:fs/promises'
import { saveImport } from './import-upload.js'
import { isRenpySave } from './savefile.js'
import { HttpError, cleanRelPath, isSaveDirName } from '../util/paths.js'
import type { Services } from '../services.js'

/** What a computer's Ren'Py folder may bring: saves and persistent data at a save folder's top. */
const importable = (name: string) => !name.includes('/') && (name.endsWith('.save') || name === 'persistent')

/**
 * The guided import of a computer's Ren'Py folder. The browser reads the folder (or a zip of it)
 * itself and compares it with the index, so nothing is uploaded for the preview. It then sends only
 * the files that change something. The newer copy of each takes the slot and the older one goes to
 * History, as with two devices. Folders of games not in the library are kept for when they are added.
 */
export function createSavesImportRouter(s: Services): Router {
  const { db, content, catalog } = s
  const store = () => s.saves
  const router = Router({ caseSensitive: true, strict: true })

  router.get('/', async (_req, res) => {
    const saves = store()
    const games: Record<string, { id: string; title: string }> = {}
    for (const g of db.allGames()) {
      if (content.hides(g)) continue
      const recipe = g.recipe_id ? catalog.recipe(g.recipe_id) : null
      const dir = g.save_dir || recipe?.saveDir
      if (dir) games[dir] = { id: g.id, title: recipe?.title || g.title }
    }
    const known: Record<string, string> = {}
    for (const r of catalog.list()) if (r.saveDir && !games[r.saveDir]) known[r.saveDir] = r.title
    const dirs: Record<string, Record<string, { mtime: number; size: number }>> = {}
    for (const dir of content.visibleSaveDirs(await saves.listDirs())) {
      const files: Record<string, { mtime: number; size: number }> = {}
      for (const f of await saves.list(dir)) if (importable(f.name)) files[f.name] = { mtime: f.mtimeMs, size: f.size }
      dirs[dir] = files
    }
    res.json({ dirs, games, catalog: known })
  })

  router.post('/', saveImport('files', async (req, res) => {
    const saves = store()
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    let meta: unknown
    try {
      meta = JSON.parse(String(req.body?.meta ?? '[]'))
    } catch {
      throw new HttpError(400, 'Invalid file list')
    }
    if (!Array.isArray(meta) || meta.length !== files.length) throw new HttpError(400, 'Invalid file list')
    // Every path is checked before anything is written.
    const plan = meta.map((m: unknown) => {
      const { path, mtime } = (m && typeof m === 'object' ? m : {}) as { path?: unknown; mtime?: unknown }
      const rel = cleanRelPath(path)
      return { rel, mtime: Number(mtime) || undefined }
    })
    const visible = new Set(content.visibleSaveDirs(plan.map((p) => p.rel.split('/')[0]!)))
    const report = { added: 0, replaced: 0, kept: 0, same: 0, keys: 0, skipped: [] as string[] }
    for (const [i, file] of files.entries()) {
      const { rel, mtime } = plan[i]!
      const data = await readFile(file.path)
      if (rel === 'tokens/security_keys.txt') {
        report.keys += await saves.mergeSecurityKeys(data.toString('utf8'))
        continue
      }
      const slash = rel.indexOf('/')
      const dir = rel.slice(0, slash)
      const name = rel.slice(slash + 1)
      // A folder this person cannot see (an adult game at Off) is skipped like any other.
      if (slash < 1 || !isSaveDirName(dir) || !importable(name) || !visible.has(dir)) {
        report.skipped.push(rel)
        continue
      }
      // A broken or empty file never takes a save's place.
      if (name.endsWith('.save') && !(await isRenpySave(data))) {
        report.skipped.push(rel)
        continue
      }
      // base 0: this computer never saw the server's copy, so the newer of the two stays.
      const written = await saves.write(dir, name, data, { mtimeMs: mtime, reason: 'import', base: 0, everyKind: true })
      report[written.outcome]++
    }
    res.json(report)
  }, { fields: 1 }))

  return router
}
