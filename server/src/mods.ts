import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Config } from './config.js'
import { exists, walkFiles, writeFileAtomic } from './util/fsx.js'
import { HttpError, cleanRelPath, safeJoin } from './util/paths.js'

export interface OverlayEntry {
  path: string
  size: number
  mtimeMs: number
}

export interface OverlaySummary {
  files: number
  deleted: number
  /** Hash of the overlay content; compare with the applied hash to see if changes are pending. */
  hash: string
}

/**
 * Per-game mod overlay, stored with user data (not inside the build):
 *   <overlays>/<slug>/files/<game-relative path>   added or replaced files
 *   <overlays>/<slug>/deleted.json                 base files hidden by the mod
 */
export class Overlays {
  constructor(private readonly cfg: Config) {}

  root(slug: string): string {
    return join(this.cfg.overlaysDir, slug)
  }

  private filesDir(slug: string): string {
    return join(this.root(slug), 'files')
  }

  static editablePath(p: unknown): string {
    const rel = cleanRelPath(p)
    if (!rel.startsWith('game/')) throw new HttpError(400, 'Only files inside game/ can be modded')
    if (/^game\/(cache|saves)\//i.test(rel)) throw new HttpError(400, 'game/cache and game/saves are managed by Ren’Py')
    return rel
  }

  async list(slug: string): Promise<{ files: OverlayEntry[]; deleted: string[] }> {
    const files = (await walkFiles(this.filesDir(slug))).map((f) => ({ path: f.rel, size: f.size, mtimeMs: Math.floor(f.mtimeMs) }))
    return { files, deleted: await this.deleted(slug) }
  }

  async deleted(slug: string): Promise<string[]> {
    try {
      const v = JSON.parse(await readFile(join(this.root(slug), 'deleted.json'), 'utf-8'))
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
    } catch {
      return []
    }
  }

  private async setDeleted(slug: string, list: string[]): Promise<void> {
    await writeFileAtomic(join(this.root(slug), 'deleted.json'), JSON.stringify([...new Set(list)].sort(), null, 1))
  }

  async read(slug: string, path: string): Promise<Buffer | null> {
    try {
      return await readFile(safeJoin(this.filesDir(slug), Overlays.editablePath(path)))
    } catch {
      return null
    }
  }

  async write(slug: string, path: string, data: Buffer): Promise<void> {
    const rel = Overlays.editablePath(path)
    await writeFileAtomic(safeJoin(this.filesDir(slug), rel), data)
    const del = await this.deleted(slug)
    if (del.includes(rel)) await this.setDeleted(slug, del.filter((d) => d !== rel))
  }

  /** Hides a base file (or drops an overlay-only file). */
  async remove(slug: string, path: string, inBase: boolean): Promise<void> {
    const rel = Overlays.editablePath(path)
    await unlink(safeJoin(this.filesDir(slug), rel)).catch(() => {})
    if (inBase) await this.setDeleted(slug, [...(await this.deleted(slug)), rel])
  }

  /** Drops any overlay change to `path`, restoring the original file. */
  async revert(slug: string, path: string): Promise<void> {
    const rel = Overlays.editablePath(path)
    await unlink(safeJoin(this.filesDir(slug), rel)).catch(() => {})
    const del = await this.deleted(slug)
    if (del.includes(rel)) await this.setDeleted(slug, del.filter((d) => d !== rel))
  }

  async summary(slug: string): Promise<OverlaySummary> {
    const { files, deleted } = await this.list(slug)
    return { files: files.length, deleted: deleted.length, hash: await this.hash(slug) }
  }

  async hash(slug: string): Promise<string> {
    const { files, deleted } = await this.list(slug)
    const h = createHash('sha1')
    for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) {
      h.update(f.path + '\0')
      h.update(await readFile(join(this.filesDir(slug), f.path)))
    }
    for (const d of deleted) h.update('-' + d + '\0')
    return files.length || deleted.length ? h.digest('hex').slice(0, 16) : ''
  }

  /** Copies overlay files into an extracted project (re-applying mods after an update). */
  async copyInto(slug: string, projectDir: string, onFile?: (rel: string) => void): Promise<number> {
    const { files, deleted } = await this.list(slug)
    for (const f of files) {
      const dest = safeJoin(projectDir, f.path)
      await mkdir(dirname(dest), { recursive: true })
      await copyFile(join(this.filesDir(slug), f.path), dest)
      onFile?.(f.path)
    }
    for (const d of deleted) {
      await rm(safeJoin(projectDir, d), { force: true })
      if (d.endsWith('.rpy')) await rm(safeJoin(projectDir, d + 'c'), { force: true })
    }
    return files.length + deleted.length
  }

  /** Moves the overlay aside instead of deleting it, so nothing is lost on update. */
  async archive(slug: string): Promise<void> {
    const src = this.root(slug)
    if (!(await exists(src))) return
    const dest = join(this.cfg.overlaysDir, '.archived', `${slug}-${Date.now()}`)
    await mkdir(dirname(dest), { recursive: true })
    await rename(src, dest)
  }

  async sizeOf(slug: string, path: string): Promise<number | null> {
    try {
      return (await stat(safeJoin(this.filesDir(slug), Overlays.editablePath(path)))).size
    } catch {
      return null
    }
  }
}
