import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Db } from '../db.js'
import { existingGame } from '../pipeline/import.js'

const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })
function library(): Db {
  const root = mkdtempSync(join(tmpdir(), 'renplay-target-')); roots.push(root)
  return new Db(join(root, 'library.db'))
}

it('installs a second season beside the first when both share a save folder', () => {
  const db = library()
  db.insertGame({ id: 'fresh-women', title: 'Fresh Women', save_dir: 'FreshWomen-1593632962', recipe_id: 'fresh-women' })
  // Season 2's recipe has no game yet; the save folder alone must not pull it into Season 1.
  expect(existingGame(db, undefined, 'fresh-women-season-2', 'FreshWomen-1593632962')).toBeNull()
  // A new release of Season 1 still finds it, by recipe or by folder.
  expect(existingGame(db, undefined, 'fresh-women', 'FreshWomen-1593632962')?.id).toBe('fresh-women')
  db.close()
})

it('still links a game without a recipe to the recipe that matches its save folder', () => {
  const db = library()
  db.insertGame({ id: 'my-game', title: 'My game', save_dir: 'MyGame-1' })
  expect(existingGame(db, undefined, 'my-game-recipe', 'MyGame-1')?.id).toBe('my-game')
  expect(existingGame(db, undefined, undefined, 'MyGame-1')?.id).toBe('my-game')
  db.close()
})

it('prefers the game asked for, then the recipe link', () => {
  const db = library()
  db.insertGame({ id: 'a', title: 'A', save_dir: 'Shared', recipe_id: 'season-1' })
  db.insertGame({ id: 'b', title: 'B', save_dir: 'Shared', recipe_id: 'season-2' })
  expect(existingGame(db, 'a', 'season-2', 'Shared')?.id).toBe('a')
  expect(existingGame(db, undefined, 'season-2', 'Shared')?.id).toBe('b')
  expect(existingGame(db, undefined, 'season-3', 'Shared')).toBeNull()
  db.close()
})

it('does not replace another game that only shares the save folder of Ren\'Py\'s sample', () => {
  const db = library()
  db.insertGame({ id: 'the-question', title: 'The Question', save_dir: 'the_question-7' })
  // Another game kept the sample's save folder: it is a game of its own.
  expect(existingGame(db, undefined, undefined, 'the_question-7', 'Another game')).toBeNull()
  // A new release of The Question still updates it, whatever the title's case.
  expect(existingGame(db, undefined, undefined, 'the_question-7', 'the question')?.id).toBe('the-question')
  // Without a title to compare, a sample's folder is no proof of the same game.
  expect(existingGame(db, undefined, undefined, 'the_question-7')).toBeNull()
  // A game's own save folder still finds it when a new release renames it.
  db.insertGame({ id: 'saga', title: 'Saga Ch.1', save_dir: 'Saga-1593632962' })
  expect(existingGame(db, undefined, undefined, 'Saga-1593632962', 'Saga Ch.2')?.id).toBe('saga')
  db.close()
})
