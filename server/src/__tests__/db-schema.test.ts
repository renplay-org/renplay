import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Db } from '../db.js'

let root: string
let path: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'renplay-schema-'))
  path = join(root, 'library.db')
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function oldLibrary(): void {
  const raw = new DatabaseSync(path)
  try {
    raw.exec(readFileSync(new URL('./fixtures/library-4.0.sql', import.meta.url), 'utf8'))
    raw.exec(`INSERT INTO games (id, title, created_at, updated_at) VALUES ('story', 'Story', '2026-01-01', '2026-01-01');
      INSERT INTO settings VALUES ('adult_games', '"allow"')`)
  } finally { raw.close() }
}

/** Physical column order is not a schema difference after ALTER TABLE ADD COLUMN. */
function schema(raw: DatabaseSync): unknown {
  const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]
  return tables.map(({ name }) => ({
    name,
    columns: raw.prepare(`PRAGMA table_xinfo("${name}")`).all()
      .map(({ name, type, notnull, dflt_value, pk, hidden }) => ({ name, type, notnull, dflt_value, pk, hidden }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    indexes: raw.prepare(`PRAGMA index_list("${name}")`).all()
      .map(({ name, unique, origin, partial }) => ({ name, unique, origin, partial, columns: raw.prepare(`PRAGMA index_xinfo("${name}")`).all().map(({ seqno, name, desc, coll, key }) => ({ seqno, name, desc, coll, key })) }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  }))
}

it('migrates the real 4.0 schema to match a fresh library, including column constraints and indexes', () => {
  oldLibrary()
  const db = new Db(path)
  const fresh = new Db(':memory:')
  try {
    expect(schema(db.raw)).toEqual(schema(fresh.raw))
    expect(db.getGame('story')).toMatchObject({ title: 'Story' })
    expect(db.getSetting('adult_level', '')).toBe('shown')
  } finally { db.close(); fresh.close() }
})

it.each(['save_meta', 'settings'])('adds a missing %s table, defaulted columns and indexes, preserves rows and the floor, and is idempotent', (table) => {
  let db = new Db(path)
  db.insertGame({ id: 'story', title: 'Story' })
  db.raw.exec(`DROP TABLE ${table}; DROP INDEX games_save_dir;
    ALTER TABLE games DROP COLUMN family; ALTER TABLE games DROP COLUMN engine_label`)
  const floor = db.raw.prepare('PRAGMA user_version').get()
  db.close()
  db = new Db(path)
  const fresh = new Db(':memory:')
  try {
    expect(schema(db.raw)).toEqual(schema(fresh.raw))
    expect(db.getGame('story')).toMatchObject({ title: 'Story', family: 'renpy', engine_label: '' })
    expect(db.raw.prepare('PRAGMA user_version').get()).toEqual(floor)
    const before = db.raw.prepare('PRAGMA schema_version').get()
    const rows = db.raw.prepare('SELECT * FROM games').all()
    db.close()
    db = new Db(path)
    expect(db.raw.prepare('PRAGMA schema_version').get()).toEqual(before)
    expect(db.raw.prepare('SELECT * FROM games').all()).toEqual(rows)
    expect(db.raw.prepare('PRAGMA user_version').get()).toEqual(floor)
  } finally { db.close(); fresh.close() }
})

it('leaves newer columns, tables, indexes and existing column definitions alone', () => {
  let db = new Db(path)
  db.raw.exec(`ALTER TABLE games ADD COLUMN future_note TEXT;
    CREATE TABLE future_table (id TEXT PRIMARY KEY);
    CREATE INDEX future_index ON games(future_note);
    ALTER TABLE games DROP COLUMN engine_label;
    ALTER TABLE games ADD COLUMN engine_label BLOB DEFAULT NULL`)
  db.insertGame({ id: 'story', title: 'Story' })
  db.raw.exec("UPDATE games SET future_note = 'Keep me'")
  const before = schema(db.raw)
  db.close()
  db = new Db(path)
  try {
    expect(schema(db.raw)).toEqual(before)
    expect(db.raw.prepare('SELECT future_note, engine_label FROM games').get()).toEqual({ future_note: 'Keep me', engine_label: null })
  } finally { db.close() }
})

it('keeps the floor accepted by 4.9.0 and 4.10.0 even when newer migration metadata is present', () => {
  let db = new Db(path)
  db.setSetting('schema_migration', 20)
  db.raw.exec('ALTER TABLE jobs DROP COLUMN retry_of; ALTER TABLE jobs DROP COLUMN position')
  db.close()
  db = new Db(path)
  try {
    const { user_version: v } = db.raw.prepare('PRAGMA user_version').get() as { user_version: number }
    // v4.9.0 and v4.10.0 db.ts both use VERSION = 19, OLDEST = 16 and this refusal rule.
    expect(v).toBe(19)
    expect(v >= 16 && v <= 19).toBe(true)
    expect(db.getSetting('schema_migration', 0)).toBe(20)
    db.insertJob({ id: 'job', type: 'import', game: '', params: '{}' })
    expect(db.getJob('job')).toMatchObject({ retry_of: '', position: 1 })
  } finally { db.close() }
})

it('refuses a higher compatibility floor with the existing message, without touching the schema', () => {
  const raw = new DatabaseSync(path)
  raw.exec('CREATE TABLE future_table (value TEXT); PRAGMA user_version = 20')
  const before = schema(raw)
  raw.close()
  expect(() => new Db(path)).toThrow('This library was made by a newer Renplay (database version 20). Start that version, or a newer one.')
  const after = new DatabaseSync(path)
  try {
    expect(schema(after)).toEqual(before)
    expect(after.prepare('PRAGMA user_version').get()).toEqual({ user_version: 20 })
  } finally { after.close() }
})

it('copies the database before each numbered migration, retaining its rows and previous floor', () => {
  oldLibrary()
  new Db(path).close()
  const dir = join(root, 'backups', 'saves', 'library')
  const copies = readdirSync(dir).sort()
  expect(copies).toHaveLength(3)
  for (const [i, name] of copies.entries()) {
    expect(name).toMatch(new RegExp(`^library-before-${16 + i}-to-${17 + i}-.+\\.db$`))
    const copy = new DatabaseSync(join(dir, name), { readOnly: true })
    try {
      expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(copy.prepare('PRAGMA user_version').get()).toEqual({ user_version: 16 + i })
      expect(copy.prepare('SELECT title FROM games').get()).toEqual({ title: 'Story' })
      expect(copy.prepare("SELECT value FROM settings WHERE key = 'adult_games'").get()).toEqual({ value: '"allow"' })
    } finally { copy.close() }
  }
  // Numbered changes never run a second time, even if an old setting reappears after a downgrade.
  const db = new Db(path)
  db.setSetting('adult_games', 'block')
  db.close()
  new Db(path).close()
  expect(readdirSync(dir).sort()).toEqual(copies)
  const reopened = new Db(path)
  try { expect(reopened.getSetting('adult_games', '')).toBe('block') } finally { reopened.close() }
})

it.each([false, true])('uses the configured migration backup folder, or the mandatory local fallback when daily backups are off (%s)', (off) => {
  oldLibrary()
  const custom = join(root, 'separate-disk')
  Db.open(root, off ? null : custom).close()
  const dir = join(off ? join(root, 'backups', 'saves') : custom, 'library')
  expect(readdirSync(dir)).toHaveLength(3)
})

it('refuses invalid migration metadata instead of replaying changes', () => {
  const db = new Db(path)
  db.setSetting('schema_migration', 'invalid')
  const before = schema(db.raw)
  db.close()
  expect(() => new Db(path)).toThrow(/invalid database migration progress/)
  const raw = new DatabaseSync(path)
  try { expect(schema(raw)).toEqual(before) } finally { raw.close() }
})

it('refuses to migrate when its copy cannot be written and leaves all data and schema unchanged', () => {
  oldLibrary()
  const original = new DatabaseSync(path)
  const before = schema(original)
  const rows = original.prepare('SELECT * FROM settings').all()
  original.close()
  mkdirSync(join(root, 'backups'), { recursive: true })
  writeFileSync(join(root, 'backups', 'saves'), 'Not a folder')
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(() => new Db(path)).toThrow(/Library database not backed up.*Migration.*stopped/)
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/Library database not backed up/))
    const raw = new DatabaseSync(path)
    try {
      expect(schema(raw)).toEqual(before)
      expect(raw.prepare('SELECT * FROM settings').all()).toEqual(rows)
      expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 16 })
      expect(raw.prepare('SELECT title FROM games').get()).toEqual({ title: 'Story' })
    } finally { raw.close() }
  } finally { error.mockRestore() }
})
