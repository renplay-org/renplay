import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { isRenpy } from './shared/family.js'
import { initializeLibrary } from './db-schema.js'

export type GameStatus = 'installed' | 'not_installed' | 'installing'

export interface GameSource {
  /** Path relative to the archives dir. */
  archive?: string
  size?: number
  sha256?: string
}

export interface BuildOptions {
  optimizeImages?: boolean
  imageQuality?: number
}

export interface WalkthroughRow {
  /** The file in the walkthroughs folder, named by Renplay. */
  file: string
  game: string
  title: string
  kind: 'pdf' | 'image' | 'text'
  size: number
  added_at: string
  position: number
}

/** A game that is a web page of its own (HTML, Unity WebGL and the like): every family but Ren'Py. */
export const isWebGame = (g: Pick<GameRow, 'family'>): boolean => !isRenpy(g)

export interface GameRow {
  id: string
  title: string
  recipe_id: string
  version: string
  /** Version of the engine the game was made with (for Ren'Py games, the Ren'Py version). */
  renpy_version: string
  /** Ren'Py runtime the game is built with; empty for other engines. */
  engine: string
  /** What made the game: renpy, html… (family.ts). */
  family: string
  /** What made it, for people: "HTML (SugarCube 2.36.1)"; empty for Ren'Py. */
  engine_label: string
  /** The page or file the game starts from, inside its build's game/; empty for Ren'Py. */
  entry: string
  /** Current build directory name, `<build>` or `<build>.m<modhash>`. */
  build: string
  status: GameStatus
  size_bytes: number
  file_count: number
  screen_w: number
  screen_h: number
  save_dir: string
  source: string
  build_options: string
  created_at: string
  installed_at: string
  /** 1 when the game's recipe is adult: the last thing the catalog said, kept for when it can no longer say (content/mode.ts). */
  adult: number
  updated_at: string
}

export interface JobRow {
  id: string
  type: string
  game: string
  status: 'queued' | 'paused' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
  stage: string
  progress: number
  message: string
  params: string
  result: string
  error: string
  log: string
  /** The job this one is a retry of, or ''. Only a retry makes an attempt. */
  retry_of: string
  /** Where a waiting job (queued or paused) stands in the queue: the lowest runs first. */
  position: number
  created_at: string
  started_at: string
  finished_at: string
}

export interface ArchiveRow {
  path: string
  size: number
  mtime_ms: number
  sha256: string
  info: string
  scanned_at: string
}

const now = () => new Date().toISOString()

/** Not a job that a retry took over from. */
const SHOWN = "id NOT IN (SELECT retry_of FROM jobs WHERE retry_of != '')"

export class Db {
  readonly raw: DatabaseSync

  constructor(path: string, backupDir = join(dirname(path), 'backups', 'saves')) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA journal_mode = WAL')
    this.raw.exec('PRAGMA synchronous = NORMAL')
    this.raw.exec('PRAGMA busy_timeout = 5000')
    try {
      initializeLibrary(this.raw, backupDir)
    } catch (error) {
      if (this.raw.isTransaction) this.raw.exec('ROLLBACK')
      this.raw.close()
      throw error
    }
  }

  static open(dataDir: string, backupDir?: string | null): Db {
    return new Db(join(dataDir, 'library.db'), backupDir ?? join(dataDir, 'backups', 'saves'))
  }

  // ---- games -------------------------------------------------------------

  allGames(): GameRow[] {
    return this.raw.prepare('SELECT * FROM games ORDER BY title COLLATE NOCASE').all() as unknown as GameRow[]
  }

  getGame(id: string): GameRow | null {
    return (this.raw.prepare('SELECT * FROM games WHERE id = ?').get(id) as unknown as GameRow) ?? null
  }

  insertGame(row: Partial<GameRow> & { id: string; title: string }): void {
    const full: Record<string, SQLInputValue> = { created_at: now(), updated_at: now(), ...(row as Record<string, SQLInputValue>) }
    const keys = Object.keys(full)
    this.raw.prepare(`INSERT INTO games (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => full[k]!))
  }

  updateGame(id: string, updates: Partial<GameRow>): boolean {
    const entries = Object.entries(updates).filter(([k, v]) => k !== 'id' && v !== undefined)
    if (!entries.length) return !!this.getGame(id)
    entries.push(['updated_at', now()])
    const res = this.raw
      .prepare(`UPDATE games SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...entries.map(([, v]) => v as SQLInputValue), id)
    return Number(res.changes) > 0
  }

  /** A game's walkthrough files, in their order. */
  walkthroughs(game: string): WalkthroughRow[] {
    return this.raw.prepare('SELECT * FROM walkthroughs WHERE game = ? ORDER BY position, added_at').all(game) as unknown as WalkthroughRow[]
  }

  deleteGame(id: string): boolean {
    this.raw.exec('BEGIN IMMEDIATE')
    try {
      this.raw.prepare('DELETE FROM user_games WHERE game = ?').run(id)
      this.raw.prepare('DELETE FROM safe_games WHERE game = ?').run(id)
      const removed = Number(this.raw.prepare('DELETE FROM games WHERE id = ?').run(id).changes) > 0
      this.raw.exec('COMMIT')
      return removed
    } catch (error) { this.raw.exec('ROLLBACK'); throw error }
  }

  gamesBySaveDir(saveDir: string): GameRow[] {
    return this.raw.prepare('SELECT * FROM games WHERE save_dir = ? ORDER BY created_at, id').all(saveDir) as unknown as GameRow[]
  }

  gameByRecipe(recipeId: string): GameRow | null {
    return (this.raw.prepare('SELECT * FROM games WHERE recipe_id = ? LIMIT 1').get(recipeId) as unknown as GameRow) ?? null
  }

  // ---- jobs --------------------------------------------------------------

  insertJob(job: Pick<JobRow, 'id' | 'type' | 'game' | 'params'> & Partial<Pick<JobRow, 'retry_of'>>): void {
    // A new job goes to the back of the queue.
    this.raw
      .prepare(
        `INSERT INTO jobs (id, type, game, status, params, retry_of, position, created_at)
         VALUES (?, ?, ?, 'queued', ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM jobs WHERE status IN ('queued', 'paused')), ?)`,
      )
      .run(job.id, job.type, job.game, job.params, job.retry_of ?? '', now())
  }

  getJob(id: string): JobRow | null {
    return (this.raw.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as JobRow) ?? null
  }

  /** The jobs people see: a job that was retried gives way to its retry (see `attempts`). */
  countJobs(): number {
    return (this.raw.prepare(`SELECT COUNT(*) AS total FROM jobs WHERE ${SHOWN}`).get() as { total: number }).total
  }

  /** Running first, then the waiting ones in the order they will run, then the finished, newest first. */
  listJobs(limit = 50, offset = 0): JobRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM jobs WHERE ${SHOWN} ORDER BY
           CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'paused' THEN 1 ELSE 2 END,
           CASE WHEN status IN ('queued', 'paused') THEN position END, CASE WHEN status IN ('queued', 'paused') THEN created_at END,
           created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as unknown as JobRow[]
  }

  /** The jobs waiting to run or paused, in queue order. */
  waitingJobs(): JobRow[] {
    return this.raw.prepare("SELECT * FROM jobs WHERE status IN ('queued', 'paused') ORDER BY position, created_at, id").all() as unknown as JobRow[]
  }

  /** How many times the job has been tried: itself and the earlier attempts it retries. */
  attempts(job: Pick<JobRow, 'retry_of'>): number {
    const seen = new Set<string>()
    let count = 1
    for (let id = job.retry_of; id && !seen.has(id); ) {
      seen.add(id)
      const earlier = this.getJob(id)
      if (!earlier) break
      count++
      id = earlier.retry_of
    }
    return count
  }

  updateJob(id: string, updates: Partial<JobRow>): void {
    const entries = Object.entries(updates).filter(([k, v]) => k !== 'id' && v !== undefined)
    if (!entries.length) return
    this.raw.prepare(`UPDATE jobs SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...entries.map(([, v]) => v as SQLInputValue), id)
  }

  /** Deletes finished jobs: all of them, or those `keep` does not keep. */
  deleteFinishedJobs(keep?: (job: JobRow) => boolean): void {
    if (!keep) {
      this.raw.exec("DELETE FROM jobs WHERE status IN ('done','failed','cancelled','interrupted')")
      return
    }
    const rows = this.raw.prepare("SELECT * FROM jobs WHERE status IN ('done','failed','cancelled','interrupted')").all() as unknown as JobRow[]
    const remove = this.raw.prepare('DELETE FROM jobs WHERE id = ?')
    for (const j of rows) if (!keep(j)) remove.run(j.id)
  }

  // ---- archives ----------------------------------------------------------

  getArchive(path: string): ArchiveRow | null {
    return (this.raw.prepare('SELECT * FROM archives WHERE path = ?').get(path) as unknown as ArchiveRow) ?? null
  }

  upsertArchive(a: { path: string; size: number; mtime_ms: number; sha256?: string; info?: string }): void {
    this.raw
      .prepare(
        `INSERT INTO archives (path, size, mtime_ms, sha256, info, scanned_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms,
           sha256 = excluded.sha256, info = excluded.info, scanned_at = excluded.scanned_at`,
      )
      .run(a.path, a.size, a.mtime_ms, a.sha256 ?? '', a.info ?? '{}', now())
  }

  markUploadedArchive(path: string, identity: string): void {
    this.raw.prepare('INSERT OR REPLACE INTO uploaded_archives (path, identity) VALUES (?, ?)').run(path, identity)
  }

  isUploadedArchive(path: string, identity: string): boolean {
    return !!this.raw.prepare('SELECT 1 FROM uploaded_archives WHERE path = ? AND identity = ?').get(path, identity)
  }

  deleteArchive(path: string): void {
    this.raw.prepare('DELETE FROM archives WHERE path = ?').run(path)
    this.raw.prepare('DELETE FROM uploaded_archives WHERE path = ?').run(path)
  }

  allArchives(): ArchiveRow[] {
    return this.raw.prepare('SELECT * FROM archives ORDER BY path').all() as unknown as ArchiveRow[]
  }

  // ---- settings ----------------------------------------------------------

  getSetting<T>(key: string, fallback: T): T {
    const row = this.raw.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row ? parseJson<T>(row.value, fallback) : fallback
  }

  setSetting(key: string, value: unknown): void {
    this.raw
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }

  close(): void {
    this.raw.close()
  }
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
