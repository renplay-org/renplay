import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export type GameStatus = 'installed' | 'not_installed' | 'installing'

export interface GameSource {
  /** Path relative to the archives dir. */
  archive?: string
  size?: number
  sha256?: string
  url?: string
}

export interface BuildOptions {
  optimizeImages?: boolean
  imageQuality?: number
}

export interface GameRow {
  id: string
  title: string
  recipe_id: string
  version: string
  renpy_version: string
  engine: string
  /** Current build directory name, `<build>` or `<build>.m<modhash>`. */
  build: string
  status: GameStatus
  size_bytes: number
  file_count: number
  screen_w: number
  screen_h: number
  save_dir: string
  /** Set when the save folder was entered by hand; detection leaves it alone. */
  save_dir_locked: number
  source: string
  build_options: string
  tags: string
  cover: string
  walkthrough: string
  created_at: string
  installed_at: string
  last_played_at: string
  updated_at: string
}

export interface JobRow {
  id: string
  type: string
  game: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
  stage: string
  progress: number
  message: string
  params: string
  result: string
  error: string
  log: string
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

const SCHEMA = `
  CREATE TABLE games (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    recipe_id       TEXT NOT NULL DEFAULT '',
    version         TEXT NOT NULL DEFAULT '',
    renpy_version   TEXT NOT NULL DEFAULT '',
    engine          TEXT NOT NULL DEFAULT '',
    build           TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'not_installed',
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    file_count      INTEGER NOT NULL DEFAULT 0,
    screen_w        INTEGER NOT NULL DEFAULT 0,
    screen_h        INTEGER NOT NULL DEFAULT 0,
    save_dir        TEXT NOT NULL DEFAULT '',
    save_dir_locked INTEGER NOT NULL DEFAULT 0,
    source          TEXT NOT NULL DEFAULT '{}',
    build_options   TEXT NOT NULL DEFAULT '{}',
    tags            TEXT NOT NULL DEFAULT '[]',
    cover           TEXT NOT NULL DEFAULT '',
    walkthrough     TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL,
    installed_at    TEXT NOT NULL DEFAULT '',
    last_played_at  TEXT NOT NULL DEFAULT '',
    updated_at      TEXT NOT NULL
  );
  CREATE INDEX games_save_dir ON games(save_dir);
  CREATE TABLE jobs (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    game        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL,
    stage       TEXT NOT NULL DEFAULT '',
    progress    REAL NOT NULL DEFAULT 0,
    message     TEXT NOT NULL DEFAULT '',
    params      TEXT NOT NULL DEFAULT '{}',
    result      TEXT NOT NULL DEFAULT '{}',
    error       TEXT NOT NULL DEFAULT '',
    log         TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    started_at  TEXT NOT NULL DEFAULT '',
    finished_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX jobs_status ON jobs(status);
  CREATE TABLE archives (
    path       TEXT PRIMARY KEY,
    size       INTEGER NOT NULL,
    mtime_ms   INTEGER NOT NULL,
    sha256     TEXT NOT NULL DEFAULT '',
    info       TEXT NOT NULL DEFAULT '{}',
    scanned_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

export class Db {
  readonly raw: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA journal_mode = WAL')
    this.raw.exec('PRAGMA synchronous = NORMAL')
    this.raw.exec('PRAGMA busy_timeout = 5000')
    const v = (this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (v === 0) {
      this.raw.exec(SCHEMA)
      this.raw.exec('PRAGMA user_version = 1')
    }
  }

  /**
   * Opens library.db. The database of renplay 1.x / 2.0 (renplay.db) described
   * the old build layout and is dropped; saves live in files and are untouched.
   */
  static open(dataDir: string): Db {
    for (const old of ['renplay.db', 'renplay.db-wal', 'renplay.db-shm']) {
      const p = join(dataDir, old)
      if (existsSync(p)) {
        rmSync(p, { force: true })
        if (old === 'renplay.db') console.log('removed the old library database (renplay.db)')
      }
    }
    return new Db(join(dataDir, 'library.db'))
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

  deleteGame(id: string): boolean {
    return Number(this.raw.prepare('DELETE FROM games WHERE id = ?').run(id).changes) > 0
  }

  gameBySaveDir(saveDir: string): GameRow | null {
    return (this.raw.prepare('SELECT * FROM games WHERE save_dir = ? LIMIT 1').get(saveDir) as unknown as GameRow) ?? null
  }

  gameByRecipe(recipeId: string): GameRow | null {
    return (this.raw.prepare('SELECT * FROM games WHERE recipe_id = ? LIMIT 1').get(recipeId) as unknown as GameRow) ?? null
  }

  // ---- jobs --------------------------------------------------------------

  insertJob(job: Pick<JobRow, 'id' | 'type' | 'game' | 'params'>): void {
    this.raw
      .prepare("INSERT INTO jobs (id, type, game, status, params, created_at) VALUES (?, ?, ?, 'queued', ?, ?)")
      .run(job.id, job.type, job.game, job.params, now())
  }

  getJob(id: string): JobRow | null {
    return (this.raw.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as JobRow) ?? null
  }

  listJobs(limit = 50): JobRow[] {
    return this.raw
      .prepare("SELECT * FROM jobs ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, created_at DESC LIMIT ?")
      .all(limit) as unknown as JobRow[]
  }

  updateJob(id: string, updates: Partial<JobRow>): void {
    const entries = Object.entries(updates).filter(([k, v]) => k !== 'id' && v !== undefined)
    if (!entries.length) return
    this.raw.prepare(`UPDATE jobs SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...entries.map(([, v]) => v as SQLInputValue), id)
  }

  deleteFinishedJobs(): void {
    this.raw.exec("DELETE FROM jobs WHERE status IN ('done','failed','cancelled','interrupted')")
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

  deleteArchive(path: string): void {
    this.raw.prepare('DELETE FROM archives WHERE path = ?').run(path)
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
