import type { Stats } from 'node:fs'
import { copyFile, rename, stat, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { Catalog } from './catalog.js'
import type { Config } from './config.js'
import { parseJson, type Db, type GameSource } from './db.js'
import type { JobContext } from './jobs.js'
import { sha256File } from './util/fsx.js'
import { cleanRelPath, safeJoin } from './util/paths.js'

/** A replaced or edited download is no longer an upload we own, even at the same path. */
export function archiveIdentity(st: Stats): string {
  return JSON.stringify([st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs])
}

/** Publish a completed upload atomically even when downloads use a separate filesystem. */
export async function publishUpload(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  }
  const temporary = join(dirname(destination), `.upload-${randomUUID()}`)
  try {
    await copyFile(source, temporary)
    await rename(temporary, destination)
    await unlink(source)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

/** The hash-archive job: an archive's sha256, kept with it and with the games installed from it, and the recipe it matches. */
export async function hashArchive(ctx: JobContext<{ path: string }>, s: { cfg: Config; db: Db; catalog: Catalog }): Promise<{ sha256: string; recipe: string | null; exact: boolean }> {
  const { cfg, db, catalog } = s
  const rel = cleanRelPath(ctx.params.path)
  const full = safeJoin(cfg.archivesDir, rel)
  const st = await stat(full)
  const sha256 = await sha256File(full, (n) => ctx.progress('Computing checksum', n / st.size))
  const prev = db.getArchive(rel)
  db.upsertArchive({ path: rel, size: st.size, mtime_ms: Math.floor(st.mtimeMs), sha256, info: prev?.info })
  for (const g of db.allGames()) {
    const src = parseJson<GameSource>(g.source, {})
    if (src.archive === rel && src.size === st.size && !src.sha256) db.updateGame(g.id, { source: JSON.stringify({ ...src, sha256 }) })
  }
  const match = catalog.match({ name: rel, size: st.size, sha256 })
  return { sha256, recipe: match?.recipe.id ?? null, exact: match?.exact ?? false }
}
