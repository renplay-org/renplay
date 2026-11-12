import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { copyDatabase } from './util/database.js'
import { log } from './util/log.js'

/** The single declared schema. Additions must also work on the oldest supported library. */
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

/** Highest compatibility floor this release understands, not the age of its additive schema. */
const VERSION = 19
/** Renplay 4.0's compatibility floor. */
const OLDEST = 16
const MIGRATION_KEY = 'schema_migration'

/** Numbered changes run once. Only a breaking change needs a higher compatibility floor. */
const MIGRATIONS: Record<number, { floor: number; apply: (raw: DatabaseSync) => void }> = {
  17: { floor: 17, apply: (raw) => {
    const columns = columnsOf(raw, 'users').map((c) => c.name)
    if (!columns.includes('pin_hash')) raw.exec("ALTER TABLE users ADD COLUMN pin_hash TEXT NOT NULL DEFAULT ''")
    if (!columns.includes('pin_failures')) raw.exec('ALTER TABLE users ADD COLUMN pin_failures INTEGER NOT NULL DEFAULT 0')
    if (!columns.includes('pin_locked_until')) raw.exec('ALTER TABLE users ADD COLUMN pin_locked_until INTEGER NOT NULL DEFAULT 0')
  } },
  18: { floor: 18, apply: (raw) => raw.exec('CREATE TABLE IF NOT EXISTS device_people (device TEXT NOT NULL, user_id INTEGER NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (device, user_id))') },
  // 4.6: retire the 3.x adult setting and picture preference. Legacy columns stay for downgrades.
  19: { floor: 19, apply: (raw) => {
    raw.exec(`INSERT INTO settings (key, value)
      SELECT 'adult_level', CASE value WHEN '"allow"' THEN '"shown"' ELSE '"off"' END FROM settings
      WHERE key = 'adult_games' AND value IN ('"allow"', '"block"') AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'adult_level')`)
    raw.exec("DELETE FROM settings WHERE key = 'adult_games'")
    raw.exec("UPDATE users SET prefs = json_remove(prefs, '$.adultPictures') WHERE json_valid(prefs)")
  } },
}
const LATEST_MIGRATION = Math.max(...Object.keys(MIGRATIONS).map(Number))
/** A release can accept a future floor before a later release starts requiring it. */
const FRESH_FLOOR = Math.max(OLDEST, ...Object.values(MIGRATIONS).map((migration) => migration.floor))

interface Column {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
  hidden: number
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
function columnsOf(raw: DatabaseSync, table: string): Column[] {
  return raw.prepare(`PRAGMA table_xinfo(${quote(table)})`).all() as unknown as Column[]
}

/** Split a CREATE TABLE body without losing column constraints or commas inside SQL expressions. */
function definitions(sql: string): Map<string, string> {
  const parts: string[] = []
  let part = '', depth = 0, quoted = ''
  for (let i = sql.indexOf('(') + 1; i < sql.lastIndexOf(')'); i++) {
    const c = sql[i]!
    if (quoted) {
      part += c
      if (c === quoted) {
        if (sql[i + 1] === quoted) part += sql[++i]
        else quoted = ''
      }
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      part += ' '
    } else if (c === '/' && sql[i + 1] === '*') {
      i = sql.indexOf('*/', i + 2) + 1
      part += ' '
    } else if (c === "'" || c === '"' || c === '`' || c === '[') {
      quoted = c === '[' ? ']' : c
      part += c
    } else if (c === ',' && depth === 0) {
      parts.push(part.trim())
      part = ''
    } else {
      if (c === '(') depth++
      if (c === ')') depth--
      part += c
    }
  }
  parts.push(part.trim())
  return new Map(parts.map((p) => {
    const token = /^(?:"((?:[^"]|"")*)"|`((?:[^`]|``)*)`|\[([^\]]+)\]|([^\s]+))/.exec(p)!
    const name = token[1]?.replaceAll('""', '"') ?? token[2]?.replaceAll('``', '`') ?? token[3] ?? token[4]!
    return [name, p]
  }))
}

/** Existing definitions and unknown objects are deliberately never changed. */
export function reconcileSchema(raw: DatabaseSync, schema = SCHEMA): void {
  const declared = new DatabaseSync(':memory:')
  try {
    declared.exec(schema)
    const tables = declared.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string }[]
    for (const table of tables) {
      if (!raw.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table.name)) {
        raw.exec(table.sql)
        continue
      }
      const existing = new Set(columnsOf(raw, table.name).map((c) => c.name))
      const declaredColumns = definitions(table.sql)
      for (const c of columnsOf(declared, table.name)) {
        if (existing.has(c.name)) continue
        if (c.pk || c.hidden || (c.notnull && (c.dflt_value === null || c.dflt_value.toUpperCase() === 'NULL'))) {
          throw new Error(`Schema column ${table.name}.${c.name} needs a numbered migration, a default or a nullable definition`)
        }
        raw.exec(`ALTER TABLE ${quote(table.name)} ADD COLUMN ${declaredColumns.get(c.name)!}`)
      }
    }
    // Implicit primary-key/unique indexes arrive with CREATE TABLE. Never replace an existing index.
    const indexes = declared.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND sql IS NOT NULL").all() as { name: string; sql: string }[]
    for (const index of indexes) {
      if (!raw.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = ?").get(index.name)) raw.exec(index.sql)
    }
  } finally { declared.close() }
}

export function initializeLibrary(raw: DatabaseSync, backupDir: string): void {
  let floor = (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (floor === 0) {
    raw.exec(`BEGIN; ${SCHEMA};
      INSERT INTO users (id, username, name, role, adult_ceiling, adult_choice, created_at) VALUES (1, 'owner', 'Owner', 'admin', 'shown', 'shown', '${new Date().toISOString()}');
      INSERT INTO settings (key, value) VALUES ('auth_default', '"on"'), ('${MIGRATION_KEY}', '${LATEST_MIGRATION}');
      PRAGMA user_version = ${FRESH_FLOOR}; COMMIT;`)
    return
  }
  if (floor < OLDEST) throw new Error('This library was made by a Renplay older than 4.0. Start Renplay 4.5.1 on it once to bring it up to date, then this version.')
  if (floor > VERSION) throw new Error(`This library was made by a newer Renplay (database version ${floor}). Start that version, or a newer one.`)
  const hasSettings = raw.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'settings'").get()
  const saved = hasSettings ? raw.prepare('SELECT value FROM settings WHERE key = ?').get(MIGRATION_KEY) as { value: string } | undefined : undefined
  const applied = saved ? Number(saved.value) : floor
  if (!Number.isSafeInteger(applied) || applied < OLDEST) throw new Error('The library has invalid database migration progress. Restore a library database backup before starting Renplay.')
  for (const [number, migration] of Object.entries(MIGRATIONS)) {
    const next = Number(number)
    if (next <= applied) continue
    try {
      const path = copyDatabase(raw, join(backupDir, 'library'), `library-before-${floor}-to-${next}`)
      log('backup', `Library database backed up before migration ${next}: ${path}`)
    } catch (error) {
      const message = `Library database not backed up. Migration ${next} stopped: ${(error as Error).message}`
      log('backup', message, 'error')
      throw new Error(message, { cause: error })
    }
    raw.exec('BEGIN')
    migration.apply(raw)
    floor = Math.max(floor, migration.floor)
    raw.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(MIGRATION_KEY, String(next))
    raw.exec(`PRAGMA user_version = ${floor}; COMMIT`)
  }
  raw.exec('BEGIN')
  reconcileSchema(raw)
  // On first open of an existing release, adopt its migration progress. Never lower a newer marker.
  raw.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(MIGRATION_KEY, String(applied))
  raw.exec('COMMIT')
}
