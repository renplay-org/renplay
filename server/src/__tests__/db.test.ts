import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Db } from '../db.js'

it('migrates version 4 progress without changing existing library metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'renplay-db-'))
  const path = join(root, 'library.db')
  let db = new Db(path)
  try {
    db.insertGame({ id: 'story', title: 'Story', save_dir: 'Story-123', favorite_at: '2026-01-01', last_played_at: '2026-01-02' })
    db.raw.exec('ALTER TABLE games DROP COLUMN play_time; ALTER TABLE games DROP COLUMN finished_at; PRAGMA user_version = 4')
    db.close()
    db = new Db(path)
    expect(db.getGame('story')).toMatchObject({ save_dir: 'Story-123', favorite_at: '2026-01-01', last_played_at: '2026-01-02', finished_at: '', play_time: 0 })
    expect(db.raw.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 5 })
    db.close()
    db = new Db(path)
    expect(db.getGame('story')?.play_time).toBe(0)
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})
