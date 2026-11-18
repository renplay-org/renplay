import { lstat, mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { bytes } from '../shared/format.js'
import type { DeletedSaves } from '../shared/api.js'
import { walkFiles } from '../util/fsx.js'
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

function parseEntry(name: string): { at: number; folder: string } | null {
  const m = ENTRY.exec(name)
  const at = m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : NaN
  return m && !Number.isNaN(at) && isSaveDirName(m[5]) ? { at, folder: m[5] } : null
}

const SAVES = 'saves'
const HISTORY = 'save-history'
const GONE = 'These saves are no longer in the trash'
const BLOCKED = 'Nothing was restored because the game has saves or History in that folder again. Renplay does not mix them.'

/** Removes the folders under `path` that hold nothing, `path` too, and nothing else. True when `path` is gone. */
async function pruneEmpty(path: string): Promise<boolean> {
  let empty = true
  for (const e of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    if (!(e.isDirectory() && (await pruneEmpty(join(path, e.name))))) empty = false
  }
  return empty && (await rmdir(path).then(() => true, () => false))
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
 * and `.../save-history/<folder>`. Deleting moves each person's folders out of the live tree with
 * renames, under the lock every save write takes, so nothing writes into the trash and a game that
 * claims the folder later starts from an empty one. Folder names and entries are always the ones
 * found on disk, never joined from a request.
 */
export class SaveTrash {
  private timers: NodeJS.Timeout[] = []

  constructor(
    private readonly dir: string,
    private readonly stores: SaveStores,
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
    const all = await walkFiles(path)
    const saves = all.filter((f) => f.rel.split('/')[2] === SAVES)
    return { files: saves.length, people: new Set(saves.map((f) => f.rel.split('/')[1])).size, size: all.reduce((n, f) => n + f.size, 0) }
  }

  private async create(folder: string): Promise<string> {
    await mkdir(this.dir, { recursive: true })
    for (let at = Date.now(); ; at++) {
      const name = entryName(at, folder)
      try {
        await mkdir(join(this.dir, name))
        return name
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
  }

  /**
   * Moves everyone's saves and History of one save folder into a new entry. `folder` is only looked
   * up among the folders of saves that no library game uses, and the name found there is what is
   * used. A game that claims the folder while this runs stops it at the next person: what moved
   * stays in the trash, and can be restored.
   */
  async delete(folder: string, inLibrary: LibraryDirs): Promise<{ folder: string; files: number; people: number; bytes: number; entry: string }> {
    const claimed = inLibrary()
    if ([...claimed].some((dir) => folderKey(dir) === folderKey(folder))) throw new HttpError(409, IN_LIBRARY)
    const matched = (await this.stores.unclaimed(claimed)).find((f) => f.folder === folder)?.folder
    if (!matched) throw new HttpError(404, NO_SAVES)
    const entry = await this.create(matched)
    const done = { folder: matched, files: 0, people: 0, bytes: 0, entry }
    try {
      for (const user of this.stores.people()) {
        const moved = await this.stores.of(user).withFolder(matched, () => this.moveOut(user, matched, join(this.dir, entry, 'users', String(user)), inLibrary))
        if (moved.files) done.people++
        done.files += moved.files
        done.bytes += moved.bytes
      }
    } finally {
      await pruneEmpty(join(this.dir, entry))
    }
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
    for (const p of plan) {
      await mkdir(join(to, p.sub), { recursive: true })
      // The check and the rename follow each other with nothing waited for in between.
      if ([...inLibrary()].some((dir) => folderKey(dir) === folderKey(name))) throw new HttpError(409, IN_LIBRARY)
      await rename(p.from, join(to, p.sub, p.name))
    }
    return { files: saves.length, bytes: saves.reduce((n, f) => n + f.size, 0) }
  }

  /**
   * Moves an entry's folders back for each person who still has an account, when the live folder
   * does not exist or is empty: nothing is mixed, so one that is not refuses the whole restore.
   */
  async restore(name: string, allowed: (folder: string) => boolean = () => true): Promise<{ folder: string; files: number; people: number; bytes: number }> {
    const entry = (await this.entries()).find((e) => e.name === name)
    if (!entry || !allowed(entry.folder)) throw new HttpError(404, GONE)
    const base = join(this.dir, entry.name)
    const people = new Set(this.stores.people())
    const plan: Array<{ user: number; sub: string; from: string; name: string }> = []
    for (const id of await readdir(join(base, 'users')).catch(() => [] as string[])) {
      if (!people.has(Number(id)) || String(Number(id)) !== id) continue
      for (const sub of [SAVES, HISTORY]) {
        for (const e of await readdir(join(base, 'users', id, sub), { withFileTypes: true }).catch(() => [])) {
          if (e.isDirectory() || (sub === HISTORY && e.isSymbolicLink())) plan.push({ user: Number(id), sub, from: join(base, 'users', id, sub, e.name), name: e.name })
        }
      }
    }
    if (!plan.length) throw new HttpError(404, 'The people who had these saves are not in Renplay any more')
    const target = (p: (typeof plan)[number]) => join(p.sub === SAVES ? this.stores.of(p.user).root : this.stores.of(p.user).historyRoot, p.name)
    for (const p of plan) if (await occupied(target(p))) throw new HttpError(409, BLOCKED)
    const done = { folder: entry.folder, files: 0, people: 0, bytes: 0 }
    let moved = 0
    try {
      for (const user of new Set(plan.map((p) => p.user))) {
        const mine = plan.filter((p) => p.user === user)
        await this.stores.of(user).withFolder(entry.folder, async () => {
          // Asked again under the lock: a game may have saved here since.
          for (const p of mine) if (await occupied(target(p))) throw new HttpError(409, BLOCKED)
          for (const p of mine) {
            const saves = p.sub === SAVES ? await walkFiles(p.from) : []
            await mkdir(dirname(target(p)), { recursive: true })
            await rename(p.from, target(p))
            moved++
            if (saves.length) done.people++
            done.files += saves.length
            done.bytes += saves.reduce((n, f) => n + f.size, 0)
          }
        })
      }
    } catch (e) {
      if (moved && e instanceof HttpError) throw new HttpError(e.status, `${e.message} Some people's saves were already restored, the rest are still in the trash.`)
      throw e
    } finally {
      await pruneEmpty(base)
    }
    return done
  }

  /**
   * Removes the entries older than 30 days, whole, with `rm` (which removes a link as a link and never follows it).
   * It only looks inside the trash folder, never at `users/`, so it needs no library check and no save lock.
   * A failure is logged and the entry stays for the next run.
   */
  async purge(): Promise<Array<{ entry: string; folder: string; files: number; bytes: number }>> {
    const swept = []
    for (const e of await this.entries()) {
      if (Date.now() - e.at <= KEPT) continue
      const path = join(this.dir, e.name)
      try {
        const st = await lstat(path)
        if (!st.isDirectory() || dirname(resolve(path)) !== resolve(this.dir)) continue
        const { files, size } = await this.measure(path)
        await rm(path, { recursive: true })
        swept.push({ entry: e.name, folder: e.folder, files, bytes: size })
        log('saves', `Deleted the saves of ${e.folder} for good: ${files} ${files === 1 ? 'file' : 'files'}, ${bytes(size)} freed`)
      } catch (err) {
        log('saves', `Could not delete the saves of ${e.folder} for good, so they stay and are tried again at the next run: ${(err as Error).message}`, 'warn')
      }
    }
    return swept
  }
}
