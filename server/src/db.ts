import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { isRenpy } from './shared/family.js'

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

/** The schema of a new library, at VERSION. */
const SCHEMA = `
  CREATE TABLE games (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    recipe_id     TEXT NOT NULL DEFAULT '',
    version       TEXT NOT NULL DEFAULT '',
    renpy_version TEXT NOT NULL DEFAULT '',
    engine        TEXT NOT NULL DEFAULT '',
    family        TEXT NOT NULL DEFAULT 'renpy',
    engine_label  TEXT NOT NULL DEFAULT '',
    entry         TEXT NOT NULL DEFAULT '',
    build         TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'not_installed',
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    file_count    INTEGER NOT NULL DEFAULT 0,
    screen_w      INTEGER NOT NULL DEFAULT 0,
    screen_h      INTEGER NOT NULL DEFAULT 0,
    save_dir      TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL DEFAULT '{}',
    build_options TEXT NOT NULL DEFAULT '{}',
    adult         INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    installed_at  TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL,
    -- Unused, kept so Renplay 4.5 can still open the library (it writes them).
    walkthrough    TEXT NOT NULL DEFAULT '',
    last_played_at TEXT NOT NULL DEFAULT '',
    favorite_at    TEXT NOT NULL DEFAULT '',
    finished_at    TEXT NOT NULL DEFAULT '',
    play_time      INTEGER NOT NULL DEFAULT 0
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
    retry_of    TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
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
  CREATE TABLE uploaded_archives (path TEXT PRIMARY KEY, identity TEXT NOT NULL);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name             TEXT NOT NULL,
    role             TEXT NOT NULL CHECK(role IN ('admin','player')),
    disabled         INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL,
    prefs            TEXT NOT NULL DEFAULT '{}',
    avatar           TEXT NOT NULL DEFAULT '',
    avatar_uploaded  INTEGER NOT NULL DEFAULT 0,
    admin_source     TEXT NOT NULL DEFAULT 'manual',
    admin_provider   TEXT NOT NULL DEFAULT '',
    admin_subject    TEXT NOT NULL DEFAULT '',
    adult_ceiling    TEXT NOT NULL DEFAULT '',
    adult_choice     TEXT NOT NULL DEFAULT '',
    pin_hash         TEXT NOT NULL DEFAULT '',
    pin_failures     INTEGER NOT NULL DEFAULT 0,
    pin_locked_until INTEGER NOT NULL DEFAULT 0,
    -- Unused, kept so Renplay 4.5 can still open the library (it writes it).
    adult_access     INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), password TEXT NOT NULL DEFAULT '', PRIMARY KEY(provider, subject));
  CREATE TABLE identity_metadata (provider TEXT NOT NULL, subject TEXT NOT NULL, username TEXT NOT NULL, PRIMARY KEY(provider, subject));
  CREATE TABLE sessions (hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, touched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '');
  CREATE TABLE tokens (hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE device_people (device TEXT NOT NULL, user_id INTEGER NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (device, user_id));
  CREATE TABLE user_games (user_id INTEGER NOT NULL REFERENCES users(id), game TEXT NOT NULL, favorite_at TEXT NOT NULL DEFAULT '', finished_at TEXT NOT NULL DEFAULT '', last_played_at TEXT NOT NULL DEFAULT '', play_time INTEGER NOT NULL DEFAULT 0, play_status TEXT NOT NULL DEFAULT '', rating INTEGER NOT NULL DEFAULT 0, not_now_at TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id, game));
  CREATE TABLE play_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, game TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, seconds INTEGER NOT NULL);
  CREATE INDEX play_sessions_user ON play_sessions (user_id, ended_at);
  CREATE TABLE safe_games (game TEXT PRIMARY KEY);
  CREATE TABLE save_meta (user_id INTEGER NOT NULL, save_dir TEXT NOT NULL, file TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', pinned_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, save_dir, file));
  CREATE TABLE walkthroughs (file TEXT PRIMARY KEY, game TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX walkthroughs_game ON walkthroughs (game, position);
  CREATE TABLE art_made (key TEXT PRIMARY KEY, file1x TEXT NOT NULL, file2x TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, thumbhash TEXT NOT NULL, tint TEXT NOT NULL, made TEXT NOT NULL DEFAULT '', adult INTEGER NOT NULL DEFAULT 0, dark INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE INDEX art_made_file1x ON art_made (file1x);
  CREATE INDEX art_made_file2x ON art_made (file2x);
  CREATE TABLE art_choices (game TEXT NOT NULL, kind TEXT NOT NULL, scope INTEGER NOT NULL, candidate TEXT NOT NULL, PRIMARY KEY (game, kind, scope));
  CREATE TABLE art_uploads (id TEXT NOT NULL, game TEXT NOT NULL, kind TEXT NOT NULL, scope INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, focal TEXT NOT NULL DEFAULT '', thumbhash TEXT NOT NULL, tint TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (id, game, kind, scope));
  CREATE TABLE art_measured (id TEXT PRIMARY KEY, width INTEGER NOT NULL, height INTEGER NOT NULL, thumbhash TEXT NOT NULL, tint TEXT NOT NULL);
`

/** Not a job that a retry took over from. */
const SHOWN = "id NOT IN (SELECT retry_of FROM jobs WHERE retry_of != '')"

/** The schema version SCHEMA creates and the migrations below reach. */
const VERSION = 20
/** The oldest library this version opens: Renplay 4.0's. */
const OLDEST = 16

/**
 * The steps from one 4.x schema to the next. A library from before 4.0 is not opened: Renplay 4.5.1
 * brings it up to date first.
 */
const MIGRATIONS: Record<number, (raw: DatabaseSync) => void> = {
  // 4.1: a PIN to switch to a person on a device that is already signed in.
  17: (raw) => {
    const columns = columnsOf(raw, 'users')
    if (!columns.includes('pin_hash')) raw.exec("ALTER TABLE users ADD COLUMN pin_hash TEXT NOT NULL DEFAULT ''")
    if (!columns.includes('pin_failures')) raw.exec('ALTER TABLE users ADD COLUMN pin_failures INTEGER NOT NULL DEFAULT 0')
    if (!columns.includes('pin_locked_until')) raw.exec('ALTER TABLE users ADD COLUMN pin_locked_until INTEGER NOT NULL DEFAULT 0')
  },
  // 4.1: the people who signed in on each browser (its cookie, hashed), the only ones Who is playing offers there.
  18: (raw) => raw.exec('CREATE TABLE IF NOT EXISTS device_people (device TEXT NOT NULL, user_id INTEGER NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (device, user_id))'),
  // 4.6: the installation's adult level from its 3.x setting moves to the current one, and a
  // person's 3.x picture preference goes. The columns earlier versions wrote for 3.x stay (SCHEMA).
  19: (raw) => {
    raw.exec(`INSERT INTO settings (key, value)
      SELECT 'adult_level', CASE value WHEN '"allow"' THEN '"shown"' ELSE '"off"' END FROM settings
      WHERE key = 'adult_games' AND value IN ('"allow"', '"block"') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'adult_level')`)
    raw.exec("DELETE FROM settings WHERE key = 'adult_games'")
    raw.exec("UPDATE users SET prefs = json_remove(prefs, '$.adultPictures') WHERE json_valid(prefs)")
  },
  // 4.9: a job knows which job it retries, and a waiting job its place in the queue. Both have
  // defaults, so the jobs already there (queued ones keep running oldest first) need no filling in.
  20: (raw) => {
    const columns = columnsOf(raw, 'jobs')
    if (!columns.includes('retry_of')) raw.exec("ALTER TABLE jobs ADD COLUMN retry_of TEXT NOT NULL DEFAULT ''")
    if (!columns.includes('position')) raw.exec('ALTER TABLE jobs ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
  },
}

function columnsOf(raw: DatabaseSync, table: string): string[] {
  return raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => String(c['name']))
}

export class Db {
  readonly raw: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA journal_mode = WAL')
    this.raw.exec('PRAGMA synchronous = NORMAL')
    this.raw.exec('PRAGMA busy_timeout = 5000')
    try {
      const v = (this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
      if (v === 0) {
        // A new library: its owner starts at Shown like any first admin, and sign-in is on.
        this.raw.exec(`BEGIN; ${SCHEMA};
          INSERT INTO users (id, username, name, role, adult_ceiling, adult_choice, created_at) VALUES (1, 'owner', 'Owner', 'admin', 'shown', 'shown', '${now()}');
          INSERT INTO settings (key, value) VALUES ('auth_default', '"on"');
          PRAGMA user_version = ${VERSION}; COMMIT;`)
      } else if (v < OLDEST) {
        throw new Error('This library was made by a Renplay older than 4.0. Start Renplay 4.5.1 on it once to bring it up to date, then this version.')
      } else if (v > VERSION) {
        throw new Error(`This library was made by a newer Renplay (database version ${v}). Start that version, or a newer one.`)
      }
      for (let next = v + 1; v !== 0 && next <= VERSION; next++) {
        this.raw.exec('BEGIN')
        MIGRATIONS[next]!(this.raw)
        this.raw.exec(`PRAGMA user_version = ${next}; COMMIT`)
      }
    } catch (error) {
      if (this.raw.isTransaction) this.raw.exec('ROLLBACK')
      this.raw.close()
      throw error
    }
  }

  static open(dataDir: string): Db {
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

  gameBySaveDir(saveDir: string): GameRow | null {
    return (this.raw.prepare('SELECT * FROM games WHERE save_dir = ? LIMIT 1').get(saveDir) as unknown as GameRow) ?? null
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
