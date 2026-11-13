import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { reconcileSchema } from '../db-schema.js'

let raw: DatabaseSync
beforeEach(() => {
  raw = new DatabaseSync(':memory:')
  raw.exec("CREATE TABLE things (id TEXT PRIMARY KEY); INSERT INTO things VALUES ('old'); PRAGMA user_version = 19")
})
afterEach(() => { raw.close() })

it('adds nullable and defaulted columns with their declared checks, references, quoting and SQL expressions', () => {
  const declaration = `CREATE TABLE things (
    id TEXT PRIMARY KEY,
    optional TEXT,
    -- A comment, with a comma.
    required TEXT NOT NULL DEFAULT 'New',
    "quoted label" TEXT NOT NULL DEFAULT 'It''s, -- fine' CHECK(length("quoted label") > 0),
    /* Another comment, with parentheses (). */
    parent INTEGER REFERENCES parents(id) DEFAULT NULL,
    expression INTEGER DEFAULT (3)
  );
  CREATE TABLE parents (id INTEGER PRIMARY KEY);
  CREATE INDEX thing_label ON things("quoted label" COLLATE NOCASE) WHERE optional IS NOT NULL;`
  reconcileSchema(raw, declaration)
  const fresh = new DatabaseSync(':memory:')
  try {
    fresh.exec(declaration)
    expect(raw.prepare('PRAGMA table_xinfo(things)').all()).toEqual(fresh.prepare('PRAGMA table_xinfo(things)').all())
    expect(raw.prepare('PRAGMA foreign_key_list(things)').all()).toEqual(fresh.prepare('PRAGMA foreign_key_list(things)').all())
    expect(raw.prepare('PRAGMA index_list(things)').all()).toEqual(fresh.prepare('PRAGMA index_list(things)').all())
    expect(raw.prepare('PRAGMA index_xinfo(thing_label)').all()).toEqual(fresh.prepare('PRAGMA index_xinfo(thing_label)').all())
    expect(raw.prepare('SELECT * FROM things').get()).toEqual({ id: 'old', optional: null, required: 'New', 'quoted label': "It's, -- fine", parent: null, expression: 3 })
    expect(() => raw.exec('UPDATE things SET "quoted label" = \'\'')).toThrow(/CHECK/)
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 19 })
  } finally { fresh.close() }
})

it.each([
  'required TEXT NOT NULL',
  'required TEXT NOT NULL DEFAULT NULL',
  'required TEXT PRIMARY KEY',
  'required TEXT UNIQUE',
  'required INTEGER GENERATED ALWAYS AS (length(id)) STORED',
])('rejects an unsafe additive declaration in tests: %s', (column) => {
  expect(() => reconcileSchema(raw, `CREATE TABLE things (id TEXT PRIMARY KEY, ${column})`)).toThrow()
  expect(raw.prepare('SELECT * FROM things').all()).toEqual([{ id: 'old' }])
  expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 19 })
})
