import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import { sha1 } from '../util/fsx.js'
import { HttpError } from '../util/paths.js'
import { folderKey } from './folders.js'
import { SaveStore, SHARED_DIRS, isSharedDir } from './store.js'

/** What a person wrote about one of their saves. A save with none of it has no row. */
export interface SaveNote {
  title: string
  note: string
  pinned_at: string
}

const NO_NOTE: SaveNote = { title: '', note: '', pinned_at: '' }

/** How long a name waits for its save to turn up under another file name. */
const PARKED_FOR = 14 * 24 * 3600_000

/** A save file of the slots: Ren'Py's own, in the save folder itself. */
const isSlot = (file: string): boolean => file.endsWith('.save') && !file.includes('/')

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

  of(user: number): SaveStore {
    if (!this.db.raw.prepare('SELECT 1 FROM users WHERE id = ?').get(user)) throw new HttpError(404, 'User not found')
    let s = this.stores.get(user)
    if (!s) {
      const root = this.folder(user)
      s = new SaveStore(join(root, 'saves'), join(root, 'save-history'), this.cfg.saveHistoryVersions, (dir, file) => !!this.note(user, dir, file).pinned_at, (dir, file, before, after) => this.follow(user, dir, file, before, after))
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

  /** Everyone's ids. */
  people(): number[] {
    return (this.db.raw.prepare('SELECT id FROM users ORDER BY id').all() as Array<{ id: number }>).map((u) => u.id)
  }

  /**
   * What everyone has in the save folders that are not in `claimed`, one entry for each folder
   * that holds a save: the people with saves in it, the files, their bytes and the time of the newest.
   * A folder that differs from a library game's only in capitals, and a shared folder, is not offered:
   * deleting it is refused too.
   */
  async unclaimed(claimed: ReadonlySet<string>): Promise<Array<{ folder: string; people: number; files: number; bytes: number; newest: number }>> {
    const found = new Map<string, { folder: string; people: number; files: number; bytes: number; newest: number }>()
    const used = new Set([...claimed].map(folderKey))
    for (const user of this.people()) {
      const store = this.of(user)
      for (const folder of await store.listDirs()) {
        if (used.has(folderKey(folder)) || isSharedDir(folder)) continue
        const files = await store.list(folder)
        if (!files.length) continue
        const row = found.get(folder) ?? { folder, people: 0, files: 0, bytes: 0, newest: 0 }
        row.people++
        row.files += files.length
        row.bytes += files.reduce((n, f) => n + f.size, 0)
        row.newest = Math.max(row.newest, ...files.map((f) => f.mtimeMs))
        found.set(folder, row)
      }
    }
    return [...found.values()]
  }

  /** The notes of a person's saves in one folder, by file. */
  notes(user: number, dir: string): Map<string, SaveNote> {
    const rows = this.db.raw.prepare('SELECT file, title, note, pinned_at FROM save_meta WHERE user_id = ? AND save_dir = ?').all(user, dir) as unknown as Array<SaveNote & { file: string }>
    return new Map(rows.map((r) => [r.file, r]))
  }

  note(user: number, dir: string, file: string): SaveNote {
    return (this.db.raw.prepare('SELECT title, note, pinned_at FROM save_meta WHERE user_id = ? AND save_dir = ? AND file = ?').get(user, dir, file) as SaveNote | undefined) ?? NO_NOTE
  }

  /**
   * Keeps what a person wrote about a save. Nothing written leaves no row. `hash` is the SHA-1 of
   * the save it was written about, which is how it follows the save to another file name.
   */
  setNote(user: number, dir: string, file: string, next: SaveNote, hash: string): void {
    if (!next.title && !next.note && !next.pinned_at) this.dropNote(user, dir, file)
    else this.db.raw.prepare('INSERT INTO save_meta (user_id, save_dir, file, title, note, pinned_at, hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, save_dir, file) DO UPDATE SET title = excluded.title, note = excluded.note, pinned_at = excluded.pinned_at, hash = excluded.hash').run(user, dir, file, next.title, next.note, next.pinned_at, hash)
  }

  /**
   * A save file was written. Ren'Py moves quick saves and autosaves up a slot when it saves, which
   * the runtime sends as new content for each file, so a name follows its save by content:
   * - a file whose save was replaced lets go of its name, and the name waits (parked) for the same
   *   save to turn up under another file name;
   * - a file that now holds a save with a name, parked or on another file, takes the name.
   * A save with other content than any named one gets nothing. A pin is the exception: it protects
   * the slot's history, so it stays on a slot that is saved over in place, and moves only when its
   * save turns up in another file.
   */
  private async follow(user: number, dir: string, file: string, before: Buffer | null, after: Buffer): Promise<void> {
    if (!isSlot(file)) return
    const now = sha1(after)
    // Rows from before names followed their save do not know what they belong to: read it.
    const unknown = (this.db.raw.prepare("SELECT file FROM save_meta WHERE user_id = ? AND save_dir = ? AND hash = '' AND file != ?").all(user, dir, file) as Array<{ file: string }>).map((r) => r.file)
    const known = new Map<string, string>()
    for (const other of unknown) {
      const data = await this.of(user).read(dir, other).catch(() => null)
      if (data) known.set(other, sha1(data))
    }
    // From here on nothing waits, so another file's write cannot come in between.
    const db = this.db.raw
    for (const [other, hash] of known) db.prepare("UPDATE save_meta SET hash = ? WHERE user_id = ? AND save_dir = ? AND file = ? AND hash = ''").run(hash, user, dir, other)
    const own = db.prepare('SELECT title, note, pinned_at, hash FROM save_meta WHERE user_id = ? AND save_dir = ? AND file = ?').get(user, dir, file) as (SaveNote & { hash: string }) | undefined
    const held = own ? own.hash || (before ? sha1(before) : '') : ''
    if (own && held === now) {
      db.prepare('UPDATE save_meta SET hash = ? WHERE user_id = ? AND save_dir = ? AND file = ?').run(now, user, dir, file)
      return
    }
    const live = db.prepare('SELECT title, note, pinned_at FROM save_meta WHERE user_id = ? AND save_dir = ? AND file != ? AND hash = ?').get(user, dir, file, now) as SaveNote | undefined
    const parked = live ? undefined : db.prepare('SELECT title, note, pinned_at, slot, slot_hash FROM save_meta_parked WHERE user_id = ? AND save_dir = ? AND hash = ?').get(user, dir, now) as (SaveNote & { slot: string; slot_hash: string }) | undefined
    const source = live ?? parked
    // A pin stays on the slot when the slot is saved over in place, so its history keeps every
    // version. It moves only with its save, to the file the same save turns up in.
    let kept = ''
    if (own) {
      const moved = held && db.prepare('SELECT 1 FROM save_meta WHERE user_id = ? AND save_dir = ? AND file != ? AND hash = ?').get(user, dir, file, held)
      if (!moved) kept = own.pinned_at
      // A bare pin has nothing to wait for when the save that comes back brings its own.
      const bare = !own.title && !own.note && !!source?.pinned_at
      if (held && !moved && !bare) this.park(user, dir, held, own, kept ? { file, hash: now } : null)
      this.dropNote(user, dir, file)
    }
    db.prepare('DELETE FROM save_meta_parked WHERE user_id = ? AND save_dir = ? AND hash = ?').run(user, dir, now)
    if (parked?.pinned_at && parked.slot && parked.slot !== file) this.unpin(user, dir, parked.slot, parked.slot_hash, parked.pinned_at)
    if (source) this.setNote(user, dir, file, { ...source, pinned_at: source.pinned_at || kept }, now)
    else if (kept) this.setNote(user, dir, file, { title: '', note: '', pinned_at: kept }, now)
  }

  /** Keeps a name for a save that left its file, for a while, and forgets the ones that waited too long. `slot` is where its pin stayed. */
  private park(user: number, dir: string, hash: string, note: SaveNote, slot: { file: string; hash: string } | null): void {
    this.db.raw.prepare('DELETE FROM save_meta_parked WHERE parked_at < ?').run(Date.now() - PARKED_FOR)
    this.db.raw.prepare('INSERT OR REPLACE INTO save_meta_parked (user_id, save_dir, hash, title, note, pinned_at, parked_at, slot, slot_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(user, dir, hash, note.title, note.note, note.pinned_at, Date.now(), slot?.file ?? '', slot?.hash ?? '')
  }

  /** The pin that stayed on a slot goes when its save turns up in another file, if the slot still holds what it did then. */
  private unpin(user: number, dir: string, file: string, hash: string, pinned: string): void {
    const row = this.db.raw.prepare('SELECT title, note FROM save_meta WHERE user_id = ? AND save_dir = ? AND file = ? AND hash = ? AND pinned_at = ?').get(user, dir, file, hash, pinned) as Pick<SaveNote, 'title' | 'note'> | undefined
    if (row) this.setNote(user, dir, file, { ...row, pinned_at: '' }, hash)
  }

  /** A deleted save's name, note and pin go with it, so a new save in the slot starts clean. */
  dropNote(user: number, dir: string, file: string): void {
    this.db.raw.prepare('DELETE FROM save_meta WHERE user_id = ? AND save_dir = ? AND file = ?').run(user, dir, file)
  }

  /** Gives one person's notes to another, where the other has none for the same file. */
  mergeNotes(from: number, to: number): void {
    this.db.raw.prepare('INSERT OR IGNORE INTO save_meta (user_id, save_dir, file, title, note, pinned_at, hash) SELECT ?, save_dir, file, title, note, pinned_at, hash FROM save_meta WHERE user_id = ?').run(to, from)
  }

  /** Forgets a removed person's notes. Their folder is moved aside by the caller. */
  forget(user: number): void {
    this.db.raw.prepare('DELETE FROM save_meta WHERE user_id = ?').run(user)
    this.db.raw.prepare('DELETE FROM save_meta_parked WHERE user_id = ?').run(user)
    this.stores.delete(user)
  }
}
