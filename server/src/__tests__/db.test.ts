import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { Db } from '../db.js'

it('forgets personal progress and safe overrides with a library entry, never carrying them onto a reused game id', () => {
  const db = new Db(':memory:')
  try {
    db.insertGame({ id: 'story', title: 'Story' })
    db.raw.prepare('INSERT INTO safe_games VALUES (?)').run('story')
    db.raw.prepare('INSERT INTO user_games (user_id, game, favorite_at) VALUES (1, ?, ?)').run('story', '2026-01-01')
    expect(db.deleteGame('story')).toBe(true)
    db.insertGame({ id: 'story', title: 'Another story' })
    expect(db.raw.prepare('SELECT * FROM user_games').all()).toEqual([])
    expect(db.raw.prepare('SELECT * FROM safe_games').all()).toEqual([])
  } finally { db.close() }
})


it('creates a new library at the current version, with its owner at Shown and sign-in on', () => {
  const db = new Db(':memory:')
  try {
    expect(db.raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 19 })
    expect(db.raw.prepare('SELECT username, role, adult_ceiling, adult_choice FROM users').all()).toEqual([{ username: 'owner', role: 'admin', adult_ceiling: 'shown', adult_choice: 'shown' }])
    expect(db.getSetting('auth_default', '')).toBe('on')
  } finally { db.close() }
})

it('brings a 4.0 library up to date, keeping its people, progress and save notes', () => {
  const root = mkdtempSync(join(tmpdir(), 'renplay-db-'))
  const path = join(root, 'library.db')
  try {
    // A 4.0 library: no PINs, no people per device, and the installation level still under its 3.x setting.
    let db = new Db(path)
    db.raw.exec(`ALTER TABLE users DROP COLUMN pin_hash; ALTER TABLE users DROP COLUMN pin_failures; ALTER TABLE users DROP COLUMN pin_locked_until;
      DROP TABLE device_people; PRAGMA user_version = 16`)
    db.raw.prepare("INSERT INTO users (username, name, role, adult_ceiling, adult_choice, prefs, created_at) VALUES ('kim', 'Kim', 'player', 'shown', 'blurred', ?, '2026-01-01')").run(JSON.stringify({ adultPictures: 'hide-pictures', tags: { include: ['romance'] } }))
    db.raw.prepare("INSERT INTO user_games (user_id, game, play_time, play_status, rating) VALUES (2, 'story', 3600, 'finished', 5)").run()
    db.raw.prepare("INSERT INTO save_meta (user_id, save_dir, file, title) VALUES (2, 'Story-1', '1-1-LT1.save', 'Before the storm')").run()
    db.raw.exec(`DELETE FROM settings WHERE key = 'adult_level'; INSERT INTO settings (key, value) VALUES ('adult_games', '"block"')`)
    db.close()

    db = new Db(path)
    expect(db.raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 19 })
    const kim = db.raw.prepare("SELECT * FROM users WHERE username = 'kim'").get() as Record<string, unknown>
    expect(kim).toMatchObject({ adult_ceiling: 'shown', adult_choice: 'blurred', pin_hash: '', pin_failures: 0 })
    expect(JSON.parse(String(kim['prefs']))).toEqual({ tags: { include: ['romance'] } })
    expect(db.raw.prepare('SELECT play_time, play_status, rating FROM user_games WHERE user_id = 2').get()).toEqual({ play_time: 3600, play_status: 'finished', rating: 5 })
    expect(db.raw.prepare('SELECT title FROM save_meta WHERE user_id = 2').get()).toEqual({ title: 'Before the storm' })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM device_people').get()).toEqual({ n: 0 })
    expect(db.getSetting('adult_level', '')).toBe('off')
    expect(db.getSetting('adult_games', null)).toBeNull()
    db.close()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

it('refuses a library from before 4.0, or from a newer Renplay, and leaves it as it was', () => {
  const root = mkdtempSync(join(tmpdir(), 'renplay-db-'))
  const path = join(root, 'library.db')
  try {
    for (const [version, message] of [[10, /older than 4\.0.*4\.5\.1/], [25, /newer Renplay/]] as const) {
      const db = new Db(path)
      db.raw.exec(`PRAGMA user_version = ${version}`)
      db.close()
      expect(() => new Db(path)).toThrow(message)
      const file = new DatabaseSync(path, { readOnly: true })
      expect(file.prepare('PRAGMA user_version').get()).toEqual({ user_version: version })
      file.close()
      rmSync(path, { force: true })
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
