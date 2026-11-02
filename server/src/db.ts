import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export type GameStatus = 'installed' | 'not_installed' | 'installing' | 'broken'
export type GameLayout = 'legacy' | 'managed' | 'none'

export interface GameSource {
  kind: 'archive' | 'upload' | 'url' | 'legacy'
  /** Path relative to the archives dir. */
  archive?: string
  archiveSha256?: string
  archiveSize?: number
  url?: string
  filename?: string
}

export interface GameRow {
  slug: string
  title: string
  tags: string
  thumbnail: string
  walkthrough: string
  sort_order: number
  created_at: string
  updated_at: string
  save_dir: string
  save_dir_source: string
  status: GameStatus
  layout: GameLayout
  build_id: string
  version: string
  renpy_version: string
  engine: string
  size_bytes: number
  file_count: number
  screen_w: number
  screen_h: number
  source: string
  options: string
  catalog_id: string
  installed_at: string
  last_played_at: string
  mods_state: string
  notes: string
}

export interface JobRow {
  id: string
  type: string
  slug: string
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

const now = () => new Date().toISOString()

export class Db {
  readonly raw: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA journal_mode = WAL')
    this.raw.exec('PRAGMA synchronous = NORMAL')
    this.raw.exec('PRAGMA busy_timeout = 5000')
    this.raw.exec('PRAGMA foreign_keys = ON')
    this.migrate()
  }

  static open(dataDir: string): Db {
    return new Db(join(dataDir, 'renplay.db'))
  }

  private version(): number {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version: number }
    return row.user_version
  }

  private columns(table: string): Set<string> {
    const rows = this.raw.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return new Set(rows.map((r) => r.name))
  }

  private migrate(): void {
    const v = this.version()
    if (v < 4) {
      // Fresh database, or one created by the original sql.js schema.
      this.raw.exec(`
        CREATE TABLE IF NOT EXISTS games (
          slug        TEXT PRIMARY KEY,
          title       TEXT NOT NULL,
          tags        TEXT DEFAULT '[]',
          thumbnail   TEXT DEFAULT '',
          sort_order  INTEGER DEFAULT 0,
          created_at  TEXT DEFAULT (datetime('now')),
          updated_at  TEXT DEFAULT (datetime('now'))
        )`)
      const cols = this.columns('games')
      if (!cols.has('walkthrough')) this.raw.exec("ALTER TABLE games ADD COLUMN walkthrough TEXT DEFAULT ''")
      if (!cols.has('save_dir')) this.raw.exec("ALTER TABLE games ADD COLUMN save_dir TEXT DEFAULT ''")
      if (!cols.has('thumbnail')) this.raw.exec("ALTER TABLE games ADD COLUMN thumbnail TEXT DEFAULT ''")
    }
    if (v < 5) {
      const cols = this.columns('games')
      const add: Array<[string, string]> = [
        ['save_dir_source', "TEXT DEFAULT ''"],
        ['status', "TEXT DEFAULT 'installed'"],
        ['layout', "TEXT DEFAULT 'legacy'"],
        ['build_id', "TEXT DEFAULT ''"],
        ['version', "TEXT DEFAULT ''"],
        ['renpy_version', "TEXT DEFAULT ''"],
        ['engine', "TEXT DEFAULT ''"],
        ['size_bytes', 'INTEGER DEFAULT 0'],
        ['file_count', 'INTEGER DEFAULT 0'],
        ['screen_w', 'INTEGER DEFAULT 0'],
        ['screen_h', 'INTEGER DEFAULT 0'],
        ['source', "TEXT DEFAULT '{}'"],
        ['options', "TEXT DEFAULT '{}'"],
        ['catalog_id', "TEXT DEFAULT ''"],
        ['installed_at', "TEXT DEFAULT ''"],
        ['last_played_at', "TEXT DEFAULT ''"],
        ['mods_state', "TEXT DEFAULT ''"],
        ['notes', "TEXT DEFAULT ''"],
      ]
      for (const [name, type] of add) if (!cols.has(name)) this.raw.exec(`ALTER TABLE games ADD COLUMN ${name} ${type}`)
      // The original scanner stored build.directory_name as save_dir, which is not
      // config.save_directory. Forget it so detection runs again.
      this.raw.exec("UPDATE games SET save_dir = '' WHERE save_dir_source = ''")
      this.raw.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
          id          TEXT PRIMARY KEY,
          type        TEXT NOT NULL,
          slug        TEXT DEFAULT '',
          status      TEXT NOT NULL,
          stage       TEXT DEFAULT '',
          progress    REAL DEFAULT 0,
          message     TEXT DEFAULT '',
          params      TEXT DEFAULT '{}',
          result      TEXT DEFAULT '{}',
          error       TEXT DEFAULT '',
          log         TEXT DEFAULT '',
          created_at  TEXT NOT NULL,
          started_at  TEXT DEFAULT '',
          finished_at TEXT DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
        CREATE TABLE IF NOT EXISTS archives (
          path        TEXT PRIMARY KEY,
          size        INTEGER NOT NULL,
          mtime_ms    INTEGER NOT NULL,
          sha256      TEXT DEFAULT '',
          info        TEXT DEFAULT '{}',
          scanned_at  TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT
        );
        CREATE TABLE IF NOT EXISTS meta (
          key   TEXT PRIMARY KEY,
          value TEXT
        );
      `)
      this.raw.exec('PRAGMA user_version = 5')
    }
  }

  // ---- games -------------------------------------------------------------

  allGames(): GameRow[] {
    return this.raw.prepare('SELECT * FROM games ORDER BY sort_order ASC, title COLLATE NOCASE ASC').all() as unknown as GameRow[]
  }

  getGame(slug: string): GameRow | null {
    return (this.raw.prepare('SELECT * FROM games WHERE slug = ?').get(slug) as unknown as GameRow) ?? null
  }

  insertGame(row: Partial<GameRow> & { slug: string; title: string }): void {
    const next = this.raw.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM games').get() as { n: number }
    const full: Record<string, SQLInputValue> = {
      tags: '[]',
      thumbnail: '',
      walkthrough: '',
      save_dir: '',
      save_dir_source: '',
      status: 'installed',
      layout: 'none',
      source: '{}',
      options: '{}',
      sort_order: next.n,
      created_at: now(),
      updated_at: now(),
      ...(row as Record<string, SQLInputValue>),
    }
    const keys = Object.keys(full)
    this.raw
      .prepare(`INSERT INTO games (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...keys.map((k) => full[k]!))
  }

  updateGame(slug: string, updates: Partial<GameRow>): boolean {
    const entries = Object.entries(updates).filter(([k, v]) => k !== 'slug' && v !== undefined)
    if (!entries.length) return !!this.getGame(slug)
    entries.push(['updated_at', now()])
    const res = this.raw
      .prepare(`UPDATE games SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE slug = ?`)
      .run(...entries.map(([, v]) => v as SQLInputValue), slug)
    return Number(res.changes) > 0
  }

  deleteGame(slug: string): boolean {
    return Number(this.raw.prepare('DELETE FROM games WHERE slug = ?').run(slug).changes) > 0
  }

  reorderGames(slugs: string[]): void {
    const stmt = this.raw.prepare('UPDATE games SET sort_order = ? WHERE slug = ?')
    this.tx(() => slugs.forEach((s, i) => stmt.run(i, s)))
  }

  gameBySaveDir(saveDir: string): GameRow | null {
    return (this.raw.prepare('SELECT * FROM games WHERE save_dir = ? LIMIT 1').get(saveDir) as unknown as GameRow) ?? null
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN')
    try {
      const r = fn()
      this.raw.exec('COMMIT')
      return r
    } catch (e) {
      this.raw.exec('ROLLBACK')
      throw e
    }
  }

  // ---- jobs --------------------------------------------------------------

  insertJob(job: Pick<JobRow, 'id' | 'type' | 'slug' | 'params'>): void {
    this.raw
      .prepare("INSERT INTO jobs (id, type, slug, status, params, created_at) VALUES (?, ?, ?, 'queued', ?, ?)")
      .run(job.id, job.type, job.slug, job.params, now())
  }

  getJob(id: string): JobRow | null {
    return (this.raw.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as unknown as JobRow) ?? null
  }

  listJobs(limit = 50): JobRow[] {
    return this.raw
      .prepare(
        "SELECT * FROM jobs ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, created_at DESC LIMIT ?",
      )
      .all(limit) as unknown as JobRow[]
  }

  updateJob(id: string, updates: Partial<JobRow>): void {
    const entries = Object.entries(updates).filter(([k, v]) => k !== 'id' && v !== undefined)
    if (!entries.length) return
    this.raw
      .prepare(`UPDATE jobs SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...entries.map(([, v]) => v as SQLInputValue), id)
  }

  deleteFinishedJobs(): void {
    this.raw.exec("DELETE FROM jobs WHERE status IN ('done','failed','cancelled','interrupted')")
  }

  // ---- archives ----------------------------------------------------------

  getArchive(path: string): { path: string; size: number; mtime_ms: number; sha256: string; info: string } | null {
    return (this.raw.prepare('SELECT * FROM archives WHERE path = ?').get(path) as any) ?? null
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

  allArchives(): Array<{ path: string; size: number; mtime_ms: number; sha256: string; info: string }> {
    return this.raw.prepare('SELECT * FROM archives ORDER BY path').all() as any
  }

  // ---- settings ----------------------------------------------------------

  getSetting<T>(key: string, fallback: T): T {
    const row = this.raw.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
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
