import { lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { bytes } from '../shared/format.js'
import type { DeletedSaves } from '../shared/api.js'
import { walkFiles } from '../util/fsx.js'
import type { Purger } from '../util/purge.js'
import { log } from '../util/log.js'
import { HttpError, isSaveDirName } from '../util/paths.js'
import { IN_LIBRARY, NO_SAVES, folderKey, type LibraryDirs } from './folders.js'
import type { SaveStores } from './stores.js'

const DAY = 24 * 3600_000
/** How long the saves an admin deleted wait in the trash for a restore. */
export const KEPT = 30 * DAY

/** An entry is `<ISO time, colons as hyphens>-<save folder>`: the time is written once, in the name, and nothing rewrites it. */
const ENTRY = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}\.\d{3})Z-(.+)$/
const entryName = (at: number, folder: string): string => `${new Date(at).toISOString().replaceAll(':', '-')}-${folder}`
/** An entry that is still being made has its name behind a dot, which nothing lists, restores or purges. */
const HIDDEN = '.'

function parseEntry(name: string): { at: number; folder: string } | null {
  const m = ENTRY.exec(name)
  const at = m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : NaN
  return m && !Number.isNaN(at) && isSaveDirName(m[5]) ? { at, folder: m[5] } : null
}

/** Each person's part of an entry says which account it was: the number alone is reused when an older database comes back. */
const ACCOUNT = 'account'
const SAVES = 'saves'
const HISTORY = 'save-history'
const GONE = 'These saves are no longer in the trash'
const FOREIGN = 'These saves belonged to an account that is not the one with that number now. Renplay does not give them to another account.'
const BLOCKED = 'Nothing was restored because the game has saves or History in that folder again. Renplay does not mix them.'

/** Removes the folders under `path` that hold nothing, `path` too, and nothing else. True when `path` is gone. */
async function pruneEmpty(path: string): Promise<boolean> {
  let empty = true
  for (const e of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    if (!(e.isDirectory() && (await pruneEmpty(join(path, e.name))))) empty = false
  }
  return empty && (await rmdir(path).then(() => true, () => false))
}

/** Like `pruneEmpty`, and a person's part that holds only its account note is empty too. True when `base` is gone. */
async function tidy(base: string): Promise<boolean> {
  for (const id of await readdir(join(base, 'users')).catch(() => [] as string[])) {
    const mine = join(base, 'users', id)
    for (const e of await readdir(mine, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) await pruneEmpty(join(mine, e.name))
    const names = await readdir(mine).catch(() => [] as string[])
    if (names.length === 1 && names[0] === ACCOUNT) await unlink(join(mine, ACCOUNT)).catch(() => {})
  }
  return pruneEmpty(base)
}

/** Only a missing folder is nothing: any other failure to read is no evidence that there is nothing. */
async function readdirIfThere(path: string) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}

/** Whether a restore may not put a folder there: anything but nothing or an empty folder. */
async function occupied(path: string): Promise<boolean> {
  const st = await lstat(path).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  return !!st && (!st.isDirectory() || (await readdir(path)).length > 0)
}

/**
 * The trash for the saves of games gone from the library: `<dir>/<entry>/users/<id>/saves/<folder>`
 * and `.../save-history/<folder>`, with `users/<id>/account` saying which account the id was.
 * Deleting moves each person's folders out of the live tree with renames, under the lock every save
 * write takes, so nothing writes into the trash and a game that claims the folder later starts from
 * an empty one. An entry is made under a hidden name and takes its own only when every person is
 * done, so nothing lists, restores or purges it half made. Folder names and entries are always the
 * ones found on disk, never joined from a request.
 */
export class SaveTrash {
  private timers: NodeJS.Timeout[] = []
  /** One restore or removal of an entry at a time. */
  private readonly busy = new Map<string, Promise<unknown>>()

  constructor(
    private readonly dir: string,
    private readonly stores: SaveStores,
    private readonly purger: Purger,
  ) {}

  start(): void {
    const run = () => void this.purge().catch((e) => log('saves', `Could not remove the deleted saves that are due: ${(e as Error).message}`, 'warn'))
    this.timers = [setTimeout(run, 5 * 60_000), setInterval(run, DAY)]
    for (const t of this.timers) t.unref()
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  /**
   * At start: a deletion a crash interrupted left an entry under its hidden name. What had moved is
   * kept: it becomes a normal entry, restorable and removed 30 days after it was made, and the rest
   * is still where it was. Then it goes on with the removals the purger had not finished.
   */
  async recover(): Promise<void> {
    for (const e of await readdir(this.dir, { withFileTypes: true }).catch(() => [])) {
      const parsed = e.isDirectory() && e.name.startsWith(HIDDEN) ? parseEntry(e.name.slice(HIDDEN.length)) : null
      if (!parsed) continue
      try {
        const name = await this.publish(e.name, parsed.at, parsed.folder)
        if (name) log('saves', `The deletion of the saves of ${parsed.folder} was interrupted. What had moved is in the trash and can be restored, the rest is still where it was.`, 'warn')
      } catch (err) {
        log('saves', `Could not finish the interrupted deletion of the saves of ${parsed.folder}, which stays as it is: ${(err as Error).message}`, 'warn')
      }
    }
    await this.purger.resume()
  }

  private async entries(): Promise<Array<{ name: string; at: number; folder: string }>> {
    const found = []
    // A link or a file here is not an entry: Dirent says what the name is without following it.
    for (const e of await readdir(this.dir, { withFileTypes: true }).catch(() => [])) {
      const parsed = e.isDirectory() ? parseEntry(e.name) : null
      if (parsed) found.push({ name: e.name, ...parsed })
    }
    return found
  }

  /** What is in the trash, newest first. `files` are the saves, `bytes` everything the entry holds, History too. */
  async list(): Promise<DeletedSaves[]> {
    const out: DeletedSaves[] = []
    for (const e of await this.entries()) {
      const { files, people, size } = await this.measure(join(this.dir, e.name))
      out.push({ entry: e.name, folder: e.folder, title: null, people, files, bytes: size, deletedAt: e.at, removeAt: e.at + KEPT })
    }
    return out.sort((a, b) => b.deletedAt - a.deletedAt || a.folder.localeCompare(b.folder))
  }

  private async measure(path: string): Promise<{ files: number; people: number; size: number }> {
    const all = (await walkFiles(path)).filter((f) => f.rel.split('/').length > 3)
    const saves = all.filter((f) => f.rel.split('/')[2] === SAVES)
    return { files: saves.length, people: new Set(saves.map((f) => f.rel.split('/')[1])).size, size: all.reduce((n, f) => n + f.size, 0) }
  }

  /** The restore and the removal of one entry do not run together. */
  private exclusive<T>(entry: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.busy.get(entry) ?? Promise.resolve()).catch(() => {}).then(fn)
    this.busy.set(entry, next)
    return next.finally(() => {
      if (this.busy.get(entry) === next) this.busy.delete(entry)
    })
  }

  /** Makes the hidden folder an entry is built in. The name is free as an entry too. */
  private async create(folder: string): Promise<{ hidden: string; at: number }> {
    await mkdir(this.dir, { recursive: true })
    for (let at = Date.now(); ; at++) {
      if (await lstat(join(this.dir, entryName(at, folder))).then(() => true, () => false)) continue
      try {
        const hidden = `${HIDDEN}${entryName(at, folder)}`
        await mkdir(join(this.dir, hidden))
        return { hidden, at }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
  }

  /** Gives a hidden entry its name, or removes it when nothing moved into it. The name it got, or null when there is nothing. */
  private async publish(hidden: string, at: number, folder: string): Promise<string | null> {
    const path = join(this.dir, hidden)
    if (await tidy(path)) return null
    for (let t = at; ; t++) {
      const name = entryName(t, folder)
      if (await lstat(join(this.dir, name)).then(() => true, () => false)) continue
      await rename(path, join(this.dir, name))
      return name
    }
  }

  /**
   * Moves everyone's saves and History of one save folder into a new entry. `folder` is only looked
   * up among the folders of saves that no library game uses, and the name found there is what is
   * used. A game that claims the folder while this runs stops it at the next person: what moved
   * is made an entry and can be restored.
   */
  async delete(folder: string, inLibrary: LibraryDirs): Promise<{ folder: string; files: number; people: number; bytes: number; entry: string }> {
    const claimed = inLibrary()
    if ([...claimed].some((dir) => folderKey(dir) === folderKey(folder))) throw new HttpError(409, IN_LIBRARY)
    const matched = (await this.stores.unclaimed(claimed)).find((f) => f.folder === folder)?.folder
    if (!matched) throw new HttpError(404, NO_SAVES)
    const { hidden, at } = await this.create(matched)
    const done = { folder: matched, files: 0, people: 0, bytes: 0, entry: '' }
    try {
      for (const user of this.stores.people()) {
        const moved = await this.stores.of(user).withFolder(matched, () => this.moveOut(user, matched, join(this.dir, hidden, 'users', String(user)), inLibrary))
        if (moved.files) done.people++
        done.files += moved.files
        done.bytes += moved.bytes
      }
    } catch (e) {
      await this.publish(hidden, at, matched).catch((err) => log('saves', `Could not name the saves of ${matched} that moved: ${(err as Error).message}`, 'warn'))
      throw e
    }
    done.entry = (await this.publish(hidden, at, matched)) ?? ''
    return done
  }

  /** One person's folder, under its lock: the saves, and the History, which may be all they have. */
  private async moveOut(user: number, name: string, to: string, inLibrary: LibraryDirs): Promise<{ files: number; bytes: number }> {
    const store = this.stores.of(user)
    const plan = []
    for (const [sub, root] of [[SAVES, store.root], [HISTORY, store.historyRoot]] as const) {
      // A link is moved as the link it is (rename never follows one), but a link is not a folder of saves.
      const found = (await readdir(root, { withFileTypes: true }).catch(() => [])).find((e) => e.name === name && (e.isDirectory() || (sub === HISTORY && e.isSymbolicLink())))
      if (found) plan.push({ sub, from: join(root, found.name), name: found.name })
    }
    const saves = plan.some((p) => p.sub === SAVES) ? await store.list(name) : []
    if (plan.length) {
      await mkdir(to, { recursive: true })
      await writeFile(join(to, ACCOUNT), this.stores.identity(user) ?? '')
    }
    for (const p of plan) {
      await mkdir(join(to, p.sub), { recursive: true })
      // The check and the rename follow each other with nothing waited for in between.
      if ([...inLibrary()].some((dir) => folderKey(dir) === folderKey(name))) throw new HttpError(409, IN_LIBRARY)
      await rename(p.from, join(to, p.sub, p.name))
      // What a person wrote about these saves goes with them, as it does when one save is deleted.
      if (p.sub === SAVES) this.stores.dropNotes(user, name)
    }
    return { files: saves.length, bytes: saves.reduce((n, f) => n + f.size, 0) }
  }

  /**
   * Moves an entry's folders back for each person whose account is still the one that had them,
   * and only when, for every such person, neither the saves nor the History of the folder exist in
   * the live tree (or are empty). Nothing is mixed, so one that is not refuses the whole restore.
   * Anything that fails to move is moved back, so a restore is whole or it did nothing.
   */
  async restore(name: string, allowed: (folder: string) => boolean = () => true): Promise<{ folder: string; files: number; people: number; bytes: number }> {
    const entry = (await this.entries()).find((e) => e.name === name)
    if (!entry || !allowed(entry.folder)) throw new HttpError(404, GONE)
    return this.exclusive(entry.name, () => this.restoreWhole(entry))
  }

  private async restoreWhole(entry: { name: string; folder: string }): Promise<{ folder: string; files: number; people: number; bytes: number }> {
    const base = join(this.dir, entry.name)
    // The entry may have been removed while this waited.
    if (!(await lstat(base).then((st) => st.isDirectory(), () => false))) throw new HttpError(404, GONE)
    const people: Array<{ user: number; dirs: Array<{ sub: string; from: string; to: string }>; files: number; bytes: number }> = []
    let foreign = false
    for (const id of (await readdirIfThere(join(base, 'users'))).map((e) => e.name).sort((a, b) => Number(a) - Number(b))) {
      const user = Number(id)
      if (String(user) !== id) continue
      const now = this.stores.identity(user)
      if (now === null) continue
      const was = await readFile(join(base, 'users', id, ACCOUNT), 'utf8').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null
        throw e
      })
      if (was !== now) {
        foreign = true
        continue
      }
      const store = this.stores.of(user)
      const mine: (typeof people)[number] = { user, dirs: [], files: 0, bytes: 0 }
      for (const [sub, root] of [[SAVES, store.root], [HISTORY, store.historyRoot]] as const) {
        for (const e of await readdirIfThere(join(base, 'users', id, sub))) {
          if (!(e.isDirectory() || (sub === HISTORY && e.isSymbolicLink()))) continue
          const from = join(base, 'users', id, sub, e.name)
          mine.dirs.push({ sub, from, to: join(root, e.name) })
          if (sub === SAVES) {
            const files = await walkFiles(from)
            mine.files += files.length
            mine.bytes += files.reduce((n, f) => n + f.size, 0)
          }
        }
      }
      if (mine.dirs.length) people.push(mine)
    }
    if (!people.length) throw foreign ? new HttpError(409, FOREIGN) : new HttpError(404, 'The people who had these saves are not in Renplay any more')
    return this.underLocks(people.map((p) => p.user), entry.folder, async () => {
      // Under the locks, and for every person in the entry, both live folders: whatever the entry holds, a game may have saved here since.
      for (const p of people) {
        const store = this.stores.of(p.user)
        for (const root of [store.root, store.historyRoot]) if (await occupied(join(root, entry.folder))) throw new HttpError(409, BLOCKED)
      }
      const moved: Array<{ from: string; to: string }> = []
      try {
        for (const d of people.flatMap((p) => p.dirs)) {
          await mkdir(dirname(d.to), { recursive: true })
          await rename(d.from, d.to)
          moved.push(d)
        }
      } catch (e) {
        const stuck: string[] = []
        for (const m of moved.reverse()) await rename(m.to, m.from).catch(() => stuck.push(m.to))
        if (stuck.length) throw new HttpError(500, `Restoring stopped part way and these folders could not be put back in the trash, so they are in the library now: ${stuck.join(', ')}`)
        throw e
      }
      await tidy(base)
      return { folder: entry.folder, files: people.reduce((n, p) => n + p.files, 0), people: people.filter((p) => p.files).length, bytes: people.reduce((n, p) => n + p.bytes, 0) }
    })
  }

  /** Runs `fn` holding the folder's lock of every one of `users`, taken in the order of their ids. */
  private underLocks<T>(users: number[], folder: string, fn: () => Promise<T>): Promise<T> {
    const [first, ...rest] = users
    return first === undefined ? fn() : this.stores.of(first).withFolder(folder, () => this.underLocks(rest, folder, fn))
  }

  /**
   * Hands the entries older than 30 days, whole, to the purger, which removes them in the background
   * (a link goes as the link it is and is never followed). It only looks inside the trash folder, never
   * at `users/`, so it needs no library check and no save lock, only the entry's own. A failure is
   * logged and the entry stays for the next run.
   */
  async purge(): Promise<Array<{ entry: string; folder: string; files: number; bytes: number }>> {
    const swept = []
    for (const e of await this.entries()) {
      if (Date.now() - e.at <= KEPT) continue
      const path = join(this.dir, e.name)
      try {
        const done = await this.exclusive(e.name, async () => {
          // A restore ahead of this may have emptied and removed it.
          const st = await lstat(path).catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') return null
            throw err
          })
          if (!st?.isDirectory() || dirname(resolve(path)) !== resolve(this.dir)) return null
          const { files, size } = await this.measure(path)
          await this.purger.purge(path)
          return { files, size }
        })
        if (!done) continue
        swept.push({ entry: e.name, folder: e.folder, files: done.files, bytes: done.size })
        log('saves', `Deleted the saves of ${e.folder} for good: ${done.files} ${done.files === 1 ? 'file' : 'files'}, ${bytes(done.size)} freed`)
      } catch (err) {
        log('saves', `Could not delete the saves of ${e.folder} for good, so they stay and are tried again at the next run: ${(err as Error).message}`, 'warn')
      }
    }
    return swept
  }
}
