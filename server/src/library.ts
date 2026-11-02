import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from './config.js'
import { parseJson, type Db, type GameRow, type GameSource } from './db.js'
import { exists, writeFileAtomic } from './util/fsx.js'
import { isSlug, slugify } from './util/paths.js'

export const MARKER = '.renplay.json'

export interface BuildMarker {
  schema: 1
  slug: string
  buildId: string
  /** Bumped when only game.zip changes (mods), so assets stay cached. */
  zipRev: number
  engine: string | null
  sdk?: string
  title?: string
  version?: string
  saveDir?: string
  screen?: [number, number]
  createdAt: string
  optimized?: { images: number; before: number; after: number }
  mods?: { hash: string; files: number; appliedAt: string } | null
}

export async function readMarker(dir: string): Promise<BuildMarker | null> {
  try {
    return JSON.parse(await readFile(join(dir, MARKER), 'utf-8')) as BuildMarker
  } catch {
    return null
  }
}

export async function writeMarker(dir: string, m: BuildMarker): Promise<void> {
  await writeFileAtomic(join(dir, MARKER), JSON.stringify(m, null, 2))
}

export function newBuildId(): string {
  return Date.now().toString(36)
}

/** Stable id for builds without a marker, derived from game.zip identity. */
export async function legacyBuildId(dir: string): Promise<string> {
  try {
    const st = await stat(join(dir, 'game.zip'))
    return 'l' + createHash('sha1').update(`${st.size}:${Math.floor(st.mtimeMs)}`).digest('hex').slice(0, 10)
  } catch {
    return 'l0'
  }
}

export function isGameBuildDir(names: Set<string>): boolean {
  return names.has('index.html') && (names.has('game.zip') || names.has(MARKER))
}

export class Library {
  constructor(
    private readonly db: Db,
    private readonly cfg: Config,
  ) {}

  gameDir(slug: string): string {
    return join(this.cfg.gamesDir, slug)
  }

  /** Picks a free slug for a new game. */
  uniqueSlug(base: string): string {
    let s = slugify(base)
    if (!isSlug(s)) s = 'game'
    let n = 1
    let candidate = s
    while (this.db.getGame(candidate)) candidate = `${s}-${++n}`
    return candidate
  }

  /**
   * Fast scan of the games directory. Only reads directory listings and small
   * files, so it is safe to run at startup over NFS.
   */
  async scan(): Promise<{ added: string[]; missing: string[]; needsAnalysis: string[] }> {
    const added: string[] = []
    const missing: string[] = []
    const needsAnalysis: string[] = []
    let names: string[] = []
    try {
      names = await readdir(this.cfg.gamesDir)
    } catch {
      return { added, missing, needsAnalysis }
    }
    const seen = new Set<string>()
    for (const name of names) {
      if (name.startsWith('.') || name.startsWith('_') || !isSlug(name)) continue
      const dir = join(this.cfg.gamesDir, name)
      let files: Set<string>
      try {
        files = new Set(await readdir(dir))
      } catch {
        continue
      }
      if (!isGameBuildDir(files)) continue
      seen.add(name)
      const marker = files.has(MARKER) ? await readMarker(dir) : null
      const existing = this.db.getGame(name)
      if (!existing) {
        const title = marker?.title || (await readTitle(dir)) || name
        this.db.insertGame({
          slug: name,
          title,
          status: 'installed',
          layout: marker ? 'managed' : 'legacy',
          build_id: marker?.buildId ?? (await legacyBuildId(dir)),
          version: marker?.version ?? '',
          save_dir: marker?.saveDir ?? '',
          save_dir_source: marker?.saveDir ? 'detected' : '',
          engine: marker?.engine ?? '',
          screen_w: marker?.screen?.[0] ?? 0,
          screen_h: marker?.screen?.[1] ?? 0,
          source: JSON.stringify({ kind: 'legacy' } satisfies GameSource),
          installed_at: new Date().toISOString(),
        })
        added.push(name)
        if (!marker) needsAnalysis.push(name)
      } else {
        const updates: Partial<GameRow> = {}
        if (existing.status !== 'installed' && existing.status !== 'installing') updates.status = 'installed'
        if (marker) {
          if (existing.layout !== 'managed') updates.layout = 'managed'
          if (existing.build_id !== marker.buildId) updates.build_id = marker.buildId
          if (marker.engine && existing.engine !== marker.engine) updates.engine = marker.engine
        } else {
          if (existing.layout !== 'legacy') updates.layout = 'legacy'
          const bid = await legacyBuildId(dir)
          if (existing.build_id !== bid) updates.build_id = bid
          if (!existing.engine || !existing.size_bytes) needsAnalysis.push(name)
        }
        if (Object.keys(updates).length) this.db.updateGame(name, updates)
      }
    }
    for (const g of this.db.allGames()) {
      if (!seen.has(g.slug) && g.status === 'installed') {
        this.db.updateGame(g.slug, { status: 'not_installed', layout: 'none' })
        missing.push(g.slug)
      }
    }
    return { added, missing, needsAnalysis }
  }
}

async function readTitle(dir: string): Promise<string | null> {
  try {
    const html = await readFile(join(dir, 'index.html'), 'utf-8')
    const m = html.match(/<title>([^<]*)<\/title>/i)
    const t = m?.[1]?.trim()
    return t && t !== "Ren'Py Web Game" ? t : null
  } catch {
    return null
  }
}

export function gameSource(row: GameRow): GameSource {
  return parseJson<GameSource>(row.source, { kind: 'legacy' })
}

export async function hasBuild(cfg: Config, slug: string): Promise<boolean> {
  return exists(join(cfg.gamesDir, slug, 'index.html'))
}
