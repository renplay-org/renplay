import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import { HttpError } from '../util/paths.js'
import { SaveStore, SHARED_DIRS } from './store.js'

/** What a person wrote about one of their saves. A save with none of it has no row. */
export interface SaveNote {
  title: string
  note: string
  pinned_at: string
}

const NO_NOTE: SaveNote = { title: '', note: '', pinned_at: '' }

/**
 * Every person's saves. Each person's own folder is /data/users/<id>: their saves are in its
 * saves/ folder and the earlier versions in save-history/. The names, notes and pins people give
 * their saves are in save_meta.
 */
export class SaveStores {
  private readonly stores = new Map<number, SaveStore>()
  private counted: { at: number; n: number } | null = null

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
  ) {}

  /** A person's own folder, with their saves in it. */
  folder(user: number): string {
    return join(this.cfg.dataDir, 'users', String(user))
  }

  /** A person's saves. */
  of(user: number): SaveStore {
    if (!this.db.raw.prepare('SELECT 1 FROM users WHERE id = ?').get(user)) throw new HttpError(404, 'User not found')
    let s = this.stores.get(user)
    if (!s) {
      const root = this.folder(user)
      s = new SaveStore(join(root, 'saves'), join(root, 'save-history'), this.cfg.saveHistoryVersions, (dir, file) => !!this.note(user, dir, file).pinned_at)
      this.stores.set(user, s)
    }
    return s
  }

  /**
   * Copies one person's saves to another, of the folders given or all of them. A copy lands as
   * copied, and what it replaces stays in History for at least 30 days.
   */
  async copy(from: number, to: number, dirs?: string[]): Promise<number> {
    if (from === to) throw new HttpError(400, 'Choose two different users')
    const source = this.of(from), target = this.of(to)
    let copied = 0
    for (const dir of dirs ?? [...await source.listDirs(), ...SHARED_DIRS]) for (const file of await source.list(dir)) {
      const data = await source.read(dir, file.name)
      if (dir === 'tokens' && file.name === 'security_keys.txt') await target.mergeSecurityKeys(data.toString('utf-8'))
      else await target.write(dir, file.name, data, { reason: 'user-copy', mtimeMs: file.mtimeMs })
      copied++
    }
    return copied
  }

  /** Save files across everyone, counted at most once a minute. */
  async count(): Promise<number> {
    if (this.counted && Date.now() - this.counted.at < 60_000) return this.counted.n
    let n = 0
    const users = join(this.cfg.dataDir, 'users')
    for (const user of await readdir(users).catch(() => [] as string[])) {
      for (const dir of await readdir(join(users, user, 'saves')).catch(() => [] as string[])) {
        n += (await readdir(join(users, user, 'saves', dir)).catch(() => [] as string[])).filter((f) => f.endsWith('.save')).length
      }
    }
    this.counted = { at: Date.now(), n }
    return n
  }

  /** The notes of a person's saves in one folder, by file. */
  notes(user: number, dir: string): Map<string, SaveNote> {
    const rows = this.db.raw.prepare('SELECT file, title, note, pinned_at FROM save_meta WHERE user_id = ? AND save_dir = ?').all(user, dir) as unknown as Array<SaveNote & { file: string }>
    return new Map(rows.map((r) => [r.file, r]))
  }

  note(user: number, dir: string, file: string): SaveNote {
    return (this.db.raw.prepare('SELECT title, note, pinned_at FROM save_meta WHERE user_id = ? AND save_dir = ? AND file = ?').get(user, dir, file) as SaveNote | undefined) ?? NO_NOTE
  }

  /** Keeps what a person wrote about a save. Nothing written leaves no row. */
  setNote(user: number, dir: string, file: string, next: SaveNote): void {
    if (!next.title && !next.note && !next.pinned_at) this.dropNote(user, dir, file)
    else this.db.raw.prepare('INSERT INTO save_meta (user_id, save_dir, file, title, note, pinned_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, save_dir, file) DO UPDATE SET title = excluded.title, note = excluded.note, pinned_at = excluded.pinned_at').run(user, dir, file, next.title, next.note, next.pinned_at)
  }

  /** A deleted save's name, note and pin go with it, so a new save in the slot starts clean. */
  dropNote(user: number, dir: string, file: string): void {
    this.db.raw.prepare('DELETE FROM save_meta WHERE user_id = ? AND save_dir = ? AND file = ?').run(user, dir, file)
  }

  /** Gives one person's notes to another, where the other has none for the same file. */
  mergeNotes(from: number, to: number): void {
    this.db.raw.prepare('INSERT OR IGNORE INTO save_meta (user_id, save_dir, file, title, note, pinned_at) SELECT ?, save_dir, file, title, note, pinned_at FROM save_meta WHERE user_id = ?').run(to, from)
  }

  /** Forgets a removed person's notes. Their folder is moved aside by the caller. */
  forget(user: number): void {
    this.db.raw.prepare('DELETE FROM save_meta WHERE user_id = ?').run(user)
    this.stores.delete(user)
  }
}
