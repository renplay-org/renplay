import { lstat, mkdir, readFile, readdir, stat, unlink, utimes } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Writable } from 'node:stream'
import yazl from 'yazl'
import { sha1, walkFiles, writeFileAtomic } from '../util/fsx.js'
import { HttpError, cleanRelPath, isSaveDirName, safeJoin } from '../util/paths.js'
import { CLAIMED, DELETED_MARKER, IN_LIBRARY, NO_SAVES, folderKey, parseDeletedAt, removeTree, sameFolder, type LibraryDirs } from './folders.js'
import { SAVES_ZIP, SAVE_FILE_BYTES, isRenpySave } from './savefile.js'
import { isZip, readZipEntries } from '../util/zip.js'

const TOKENS_DIR = 'tokens'
/** Top-level ~/.renpy folders shared by every game: save-signing keys and MultiPersistent data. */
export const SHARED_DIRS = [TOKENS_DIR, 'persistent'] as const
/** Whether a folder name is one of the shared folders, whatever its capitals. */
const isSharedDir = (name: string): boolean => SHARED_DIRS.some((d) => folderKey(d) === folderKey(name))

/** What a write did to the slot. */
export type WriteOutcome = 'added' | 'replaced' | 'kept' | 'same'

export interface SaveFile {
  /** Path relative to the save directory. */
  name: string
  size: number
  mtimeMs: number
}

export interface HistoryVersion {
  id: string
  name: string
  size: number
  savedAt: number
  reason: string
}

function isJunk(name: string): boolean {
  const b = basename(name)
  return b.startsWith('.') || b.endsWith('.tmp') || b.endsWith('.new') || b === 'text.txt'
}

/**
 * Server-side save storage. Layout:
 *   <root>/<save_directory>/<file>     current files, as Ren'Py wrote them
 *   <root>/tokens/security_keys.txt    shared save-signing keys
 *   <historyRoot>/<save_directory>/<file>/<ts>__<reason>__<sha>   previous versions
 */
export class SaveStore {
  private static locks = new Map<string, Promise<unknown>>()
  private acceptingWrites = true

  /**
   * `pinned` says whether a save is pinned: its history keeps every version. `written` hears of
   * every write that changed a file, with the bytes it held before (null for a new file) and now.
   */
  constructor(
    readonly root: string,
    readonly historyRoot: string,
    private readonly keepVersions = 20,
    private readonly pinned: (saveDir: string, rel: string) => boolean = () => false,
    private readonly written: (saveDir: string, rel: string, before: Buffer | null, after: Buffer) => Promise<void> = async () => {},
  ) {}

  private dir(saveDir: string): string {
    if (!isSaveDirName(saveDir)) throw new HttpError(400, 'Invalid save directory')
    return safeJoin(this.root, saveDir)
  }

  /** Drain accepted writes before archiving an account; stale requests may not recreate its folder. */
  async pauseWrites(): Promise<void> {
    this.acceptingWrites = false
    await Promise.all([...SaveStore.locks].filter(([key]) => key.startsWith(this.root + '/')).map(([, operation]) => operation.catch(() => {})))
  }

  resumeWrites(): void { this.acceptingWrites = true }

  /**
   * Serializes the operations on one save folder of this person: a write, a deletion, and the
   * purge of its History. Names that differ only in capitals are one folder on some storage.
   */
  private async locked<T>(saveDir: string, fn: () => Promise<T>): Promise<T> {
    if (!this.acceptingWrites) throw new HttpError(409, 'This account is being archived')
    const key = `${this.root}/${folderKey(saveDir)}`
    const prev = SaveStore.locks.get(key) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(fn)
    SaveStore.locks.set(key, next)
    try {
      return await next
    } finally {
      if (SaveStore.locks.get(key) === next) SaveStore.locks.delete(key)
    }
  }

  async list(saveDir: string): Promise<SaveFile[]> {
    const files = await walkFiles(this.dir(saveDir))
    return files.filter((f) => !isJunk(f.rel)).map((f) => ({ name: f.rel, size: f.size, mtimeMs: Math.floor(f.mtimeMs) }))
  }

  async listDirs(): Promise<string[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true })
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !(SHARED_DIRS as readonly string[]).includes(e.name))
        .map((e) => e.name)
    } catch {
      return []
    }
  }

  async read(saveDir: string, name: string): Promise<Buffer> {
    const p = safeJoin(this.dir(saveDir), cleanRelPath(name))
    try {
      return await readFile(p)
    } catch {
      throw new HttpError(404, 'Save file not found')
    }
  }

  async stat(saveDir: string, name: string): Promise<SaveFile | null> {
    try {
      const st = await stat(safeJoin(this.dir(saveDir), cleanRelPath(name)))
      return st.isFile() ? { name, size: st.size, mtimeMs: Math.floor(st.mtimeMs) } : null
    } catch {
      return null
    }
  }

  /**
   * Writes a file, keeping the copy it replaces in History. `base` is the server's version (mtime)
   * the writer last saw, 0 for none. When a save has changed since (another device saved it), the
   * conflict rule applies: the copy saved later stays in the slot and the other goes to History as
   * a conflict. `conflict` says which: `kept` (the server's copy stayed) or `replaced`. `outcome`
   * says what happened to the slot: a file `added`, one `replaced`, the server's copy `kept`, or
   * the same file `same` as was there.
   */
  async write(saveDir: string, name: string, data: Buffer, opts: { mtimeMs?: number; reason?: SaveReason; base?: number; everyKind?: boolean; unanswered?: string } = {}): Promise<SaveFile & { outcome: WriteOutcome; conflict?: 'kept' | 'replaced' }> {
    const rel = cleanRelPath(name)
    if (isJunk(rel)) throw new HttpError(400, 'Refusing temporary file')
    if (data.length > SAVE_FILE_BYTES) throw new HttpError(413, 'Save file too large')
    const full = safeJoin(this.dir(saveDir), rel)
    return this.locked(saveDir, async () => {
      let old: Buffer | null = null
      let oldMtime = 0
      try {
        old = await readFile(full)
        oldMtime = Math.floor((await stat(full)).mtimeMs)
      } catch {}
      if (old && old.equals(data)) {
        // The same bytes from a writer that tracks versions (a device, an import) never move the
        // server's time back: an older copy of the same save is still the same save.
        if (opts.base !== undefined && opts.mtimeMs && opts.mtimeMs < oldMtime) return { name: rel, size: data.length, mtimeMs: oldMtime, outcome: 'same' }
        if (opts.mtimeMs) await utimes(full, new Date(), new Date(clampMtime(opts.mtimeMs))).catch(() => {})
        return { name: rel, size: data.length, mtimeMs: opts.mtimeMs ? clampMtime(opts.mtimeMs) : Date.now(), outcome: 'same' }
      }
      const mtime = clampMtime(opts.mtimeMs)
      // Only saves, unless asked (an import): Ren'Py merges its persistent data itself while it runs.
      // A millisecond either way is the same version, because file times are stored in seconds as
      // floating point.
      // The server's copy came from this same device when it matches an upload whose answer was lost.
      const own = !!old && !!opts.unanswered && fnv(old) === opts.unanswered
      if (old && !own && opts.base !== undefined && (opts.everyKind || rel.endsWith('.save')) && Math.abs(oldMtime - opts.base) > 1) {
        if (mtime < oldMtime) {
          await this.snapshot(saveDir, rel, data, 'conflict')
          return { name: rel, size: old.length, mtimeMs: oldMtime, outcome: 'kept', conflict: 'kept' }
        }
        await this.snapshot(saveDir, rel, old, 'conflict')
        await writeFileAtomic(full, data, new Date(mtime))
        await this.written(saveDir, rel, old, data)
        return { name: rel, size: data.length, mtimeMs: mtime, outcome: 'replaced', conflict: 'replaced' }
      }
      if (old) await this.snapshot(saveDir, rel, old, opts.reason ?? 'overwrite')
      await writeFileAtomic(full, data, new Date(mtime))
      await this.written(saveDir, rel, old, data)
      return { name: rel, size: data.length, mtimeMs: mtime, outcome: old ? 'replaced' : 'added' }
    })
  }

  /**
   * Deletes a file, keeping it in History. With `base` (the version the deleting device last saw),
   * a save another device has changed since is left alone: the answer is `changed`.
   */
  async remove(saveDir: string, name: string, reason: SaveReason = 'delete', base?: number): Promise<boolean | 'changed'> {
    const rel = cleanRelPath(name)
    const full = safeJoin(this.dir(saveDir), rel)
    return this.locked(saveDir, async () => {
      let old: Buffer
      try {
        old = await readFile(full)
      } catch {
        return false
      }
      if (base !== undefined && rel.endsWith('.save') && Math.abs(Math.floor((await stat(full)).mtimeMs) - base) > 1) return 'changed' as const
      await this.snapshot(saveDir, rel, old, reason)
      await unlink(full)
      return true
    })
  }

  /**
   * Deletes every save of a folder of a game gone from the library, each into History as a deleted
   * save goes, and notes the day in the folder's History: the 30 days are counted from it. Under the
   * folder's lock, it must be a plain folder of this person's (see `plainFolder`), and before every
   * file no library game may use it. `removed` hears of each file.
   */
  async removeFolder(saveDir: string, inLibrary: LibraryDirs, removed: (name: string) => void): Promise<SaveFile[]> {
    this.validated(saveDir)
    return this.locked(saveDir, async () => {
      if (!(await this.plainFolder(saveDir, inLibrary))) return []
      const gone: SaveFile[] = []
      let marked = false
      for (const file of await this.list(saveDir)) {
        this.refuseIfUsed(saveDir, inLibrary)
        const full = safeJoin(this.dir(saveDir), cleanRelPath(file.name))
        let old: Buffer
        try {
          old = await readFile(full)
        } catch {
          continue
        }
        if (!marked) {
          await writeFileAtomic(join(safeJoin(this.historyRoot, saveDir), DELETED_MARKER), String(Date.now()))
          marked = true
        }
        await this.snapshot(saveDir, file.name, old, 'user-delete')
        this.refuseIfUsed(saveDir, inLibrary)
        await unlink(full)
        removed(file.name)
        gone.push(file)
      }
      return gone
    })
  }

  private refuseIfUsed(saveDir: string, inLibrary: LibraryDirs): void {
    if (isSharedDir(saveDir)) throw new HttpError(404, NO_SAVES)
    for (const dir of inLibrary()) if (folderKey(dir) === folderKey(saveDir)) throw new HttpError(409, IN_LIBRARY)
  }

  /**
   * Whether this person has the folder as a plain folder: listed under exactly this name (a link or
   * another spelling is not), not the same place on disk as a shared or a library folder, and its
   * History not a link. A folder they do not have is no problem: false.
   */
  private async plainFolder(saveDir: string, inLibrary: LibraryDirs): Promise<boolean> {
    this.refuseIfUsed(saveDir, inLibrary)
    const entry = (await readdir(this.root, { withFileTypes: true }).catch(() => [])).find((e) => e.name === saveDir)
    if (!entry?.isDirectory()) return false
    for (const other of [...SHARED_DIRS, ...inLibrary()]) {
      if (!(await sameFolder(this.root, saveDir, other))) continue
      throw new HttpError(isSharedDir(other) ? 404 : 409, isSharedDir(other) ? NO_SAVES : IN_LIBRARY)
    }
    const history = await lstat(safeJoin(this.historyRoot, saveDir)).catch(() => null)
    if (history && !history.isDirectory()) throw new HttpError(409, 'The History of this folder is a link, so Renplay will not delete from it.')
    return true
  }

  /** The folders an admin's deletion left History in for this person: those with a day noted. */
  async deletedFolders(): Promise<string[]> {
    const noted = async (dir: string) => lstat(join(this.historyRoot, dir, DELETED_MARKER)).then((st) => st.isFile(), () => false)
    const dirs = (await readdir(this.historyRoot, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && isSaveDirName(e.name) && !isSharedDir(e.name))
    return (await Promise.all(dirs.map(async (e) => ((await noted(e.name)) ? e.name : '')))).filter(Boolean)
  }

  private historyDir(saveDir: string, rel: string): string {
    return safeJoin(safeJoin(this.historyRoot, saveDir), rel.replace(/\//g, '__'))
  }

  private async snapshot(saveDir: string, rel: string, data: Buffer, reason: SaveReason): Promise<void> {
    if (!isSaveDirName(saveDir)) return
    const dir = this.historyDir(saveDir, rel)
    await mkdir(dir, { recursive: true })
    const id = `${Date.now()}__${reason.replace(/[^a-z-]/g, '')}__${sha1(data).slice(0, 10)}`
    await writeFileAtomic(join(dir, id), data)
    // Prune old versions, except of a pinned save. A version that is the only copy of something (the
    // older of two, a deleted save, what an import or restore replaced) stays at least 30 days
    // however many versions follow it.
    if (this.pinned(saveDir, rel)) return
    const versions = (await readdir(dir)).filter((n) => !n.startsWith('.')).sort()
    const excess = versions.length - this.keepVersions
    if (excess <= 0) return
    const recent = Date.now() - KEEP_ONLY_COPIES
    const prunable = versions.filter((v) => {
      const [ts, why] = v.split('__')
      return !(ONLY_COPIES.has(why ?? '') && Number(ts) > recent)
    })
    for (const v of prunable.slice(0, excess)) await unlink(join(dir, v)).catch(() => {})
  }

  async history(saveDir: string, name?: string): Promise<HistoryVersion[]> {
    const base = safeJoin(this.historyRoot, this.validated(saveDir))
    let files: string[]
    try {
      files = await readdir(base)
    } catch {
      return []
    }
    const out: HistoryVersion[] = []
    for (const f of files) {
      const rel = f.replace(/__/g, '/')
      if (name && rel !== name) continue
      const dir = join(base, f)
      let versions: string[] = []
      try {
        versions = await readdir(dir)
      } catch {
        continue
      }
      for (const v of versions) {
        const [ts, reason] = v.split('__')
        const st = await stat(join(dir, v)).catch(() => null)
        if (!st) continue
        out.push({ id: `${f}/${v}`, name: rel, size: st.size, savedAt: Number(ts), reason: reason ?? '' })
      }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt)
  }

  /**
   * Deletes for good all of one folder's History, whatever put each version there, once an admin's
   * deletion of the folder is `due` (given the day noted in its History), no game in the library
   * uses the folder and this person has no saves in it again. All is decided under the folder's
   * lock, and the library is asked again before each file. A folder a game uses keeps its History
   * and loses its note. Returns what it freed, or null when it left everything. A link is removed,
   * never followed. What could not be deleted is an error, and the day stays noted until the rest is
   * gone, so the next try finds it.
   */
  async purgeHistory(saveDir: string, rule: { due: (deletedAt: number) => boolean; inLibrary: LibraryDirs }): Promise<{ files: number; bytes: number } | null> {
    const base = safeJoin(this.historyRoot, this.validated(saveDir))
    return this.locked(saveDir, async () => {
      const here = await lstat(base).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return null
        throw e
      })
      if (!here || isSharedDir(saveDir)) return null
      if (!here.isDirectory()) throw new Error('its History is a link')
      const marker = join(base, DELETED_MARKER)
      const used = () => [...rule.inLibrary()].some((dir) => folderKey(dir) === folderKey(saveDir))
      if (used()) {
        await unlink(marker).catch(() => {})
        return null
      }
      const at = parseDeletedAt(await readFile(marker, 'utf-8').catch(() => ''))
      if (at === null || !rule.due(at) || (await this.list(saveDir)).length) return null
      const done = { files: 0, bytes: 0 }
      const failed: string[] = []
      // A game that claims the folder meanwhile stops it, before the next file.
      const before = () => {
        if (used()) throw CLAIMED
      }
      try {
        for (const name of await readdir(base)) if (name !== DELETED_MARKER) await removeTree(join(base, name), done, failed, before)
        if (!failed.length) await removeTree(base, { files: 0, bytes: 0 }, failed, before)
      } catch (e) {
        if (e === CLAIMED) return null
        throw e
      }
      if (failed.length) throw new Error(`${failed.length} could not be deleted, the first: ${failed[0]}`)
      return done
    })
  }

  /** Versions kept by the conflict rule since a time, newest first, read from History's names alone. */
  async conflicts(saveDir: string, since: number): Promise<Array<{ id: string; file: string; at: number }>> {
    const base = safeJoin(this.historyRoot, this.validated(saveDir))
    const out: Array<{ id: string; file: string; at: number }> = []
    for (const f of await readdir(base).catch(() => [] as string[])) {
      for (const v of await readdir(join(base, f)).catch(() => [] as string[])) {
        const [ts, reason] = v.split('__')
        if (reason === 'conflict' && Number(ts) >= since) out.push({ id: `${f}/${v}`, file: f.replace(/__/g, '/'), at: Number(ts) })
      }
    }
    return out.sort((a, b) => b.at - a.at)
  }

  async restoreVersion(saveDir: string, id: string): Promise<SaveFile> {
    const [fileKey, version] = id.split('/')
    if (!fileKey || !version || version.includes('..') || fileKey.includes('..')) throw new HttpError(400, 'Invalid version id')
    const src = safeJoin(safeJoin(this.historyRoot, this.validated(saveDir)), `${fileKey}/${version}`)
    let data: Buffer
    try {
      data = await readFile(src)
    } catch {
      throw new HttpError(404, 'Version not found')
    }
    return this.write(saveDir, fileKey.replace(/__/g, '/'), data, { reason: 'restore' })
  }

  private validated(saveDir: string): string {
    if (!isSaveDirName(saveDir)) throw new HttpError(400, 'Invalid save directory')
    return saveDir
  }

  // ---- shared tokens ------------------------------------------------------

  /** Files of the shared folders, as paths relative to ~/.renpy. */
  async sharedFiles(): Promise<Array<{ name: string; data: Buffer; mtimeMs: number }>> {
    const out = []
    for (const dir of SHARED_DIRS) {
      for (const f of await walkFiles(join(this.root, dir))) {
        if (!isJunk(f.rel)) out.push({ name: `${dir}/${f.rel}`, data: await readFile(f.full), mtimeMs: Math.floor(f.mtimeMs) })
      }
    }
    return out
  }

  /** Copies a save into another save folder, picking a free slot name if needed. */
  async copySave(fromDir: string, name: string, toDir: string): Promise<string> {
    const rel = cleanRelPath(name)
    const data = await this.read(fromDir, rel)
    const existing = new Set((await this.list(toDir)).map((f) => f.name))
    let target = rel
    if (existing.has(target)) {
      const m = rel.match(/^(.*?)-(\d+)-(LT\d+\.save)$/)
      const page = m && !/^(auto|quick)$/.test(m[1]!) ? m[1]! : '1'
      const suffix = m?.[3] ?? 'LT1.save'
      let n = 1
      while (existing.has(`${page}-${n}-${suffix}`)) n++
      target = `${page}-${n}-${suffix}`
    }
    await this.write(toDir, target, data, { reason: 'copy' })
    return target
  }

  /**
   * Merges a security_keys.txt from another device into the shared one, so
   * saves signed there load without Ren'Py's "untrusted save" prompt.
   */
  async mergeSecurityKeys(text: string): Promise<number> {
    const path = join(this.root, TOKENS_DIR, 'security_keys.txt')
    return this.locked(TOKENS_DIR, async () => {
      let current = ''
      try {
        current = await readFile(path, 'utf-8')
      } catch {}
      const have = new Set(current.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
      const add: string[] = []
      for (const raw of text.split(/\r?\n/)) {
        // Ren'Py stores "signing-key <sk> <vk>" and "verifying-key <vk>" lines. Only
        // the verifying keys are needed to trust saves made on that device.
        const parts = raw.trim().split(/\s+/)
        const vk = parts[0] === 'signing-key' ? parts[2] : parts[0] === 'verifying-key' ? parts[1] : undefined
        if (!vk || !/^[A-Za-z0-9+/=]+$/.test(vk)) continue
        const line = `verifying-key ${vk}`
        if (!have.has(line) && !current.includes(vk)) {
          have.add(line)
          add.push(line)
        }
      }
      if (!add.length) return 0
      const next = (current && !current.endsWith('\n') ? current + '\n' : current) + add.join('\n') + '\n'
      if (current) await this.snapshot(TOKENS_DIR, 'security_keys.txt', Buffer.from(current), 'merge-keys')
      await writeFileAtomic(path, next)
      return add.length
    })
  }

  // ---- export / import ----------------------------------------------------

  async exportZip(saveDirs: string[], out: Writable, opts: { includeTokens?: boolean } = {}): Promise<void> {
    const zip = new yazl.ZipFile()
    zip.outputStream.pipe(out)
    for (const sd of saveDirs) {
      for (const f of await this.list(sd)) {
        zip.addFile(safeJoin(this.dir(sd), f.name), `${sd}/${f.name}`, { mtime: new Date(f.mtimeMs) })
      }
    }
    if (opts.includeTokens) {
      for (const t of await this.sharedFiles()) zip.addBuffer(t.data, t.name, { mtime: new Date(t.mtimeMs) })
    }
    zip.end()
    await new Promise<void>((resolve, reject) => {
      out.on('finish', resolve)
      out.on('close', resolve)
      out.on('error', reject)
    })
  }

  /**
   * Imports save data from uploaded files. Each upload may be a single save,
   * a `persistent` file, a `security_keys.txt`, or a zip bundle in any common
   * layout (Ren'Py web export, desktop save folder, `game/saves`, renplay export).
   */
  async importFiles(saveDir: string, uploads: Array<{ filename: string; data: Buffer }>): Promise<ImportReport> {
    const report: ImportReport = { imported: [], skipped: [], trustedKeys: 0 }
    for (const up of uploads) {
      const base = basename(up.filename.replace(/\\/g, '/'))
      if (base.endsWith('.save') || base === 'persistent') {
        await this.importOne(saveDir, base, up.data, report)
      } else if (base === 'security_keys.txt') {
        report.trustedKeys += await this.mergeSecurityKeys(up.data.toString('utf-8'))
      } else if (isZip(up.data)) {
        await this.importBundle(saveDir, up.filename, up.data, report)
      } else {
        report.skipped.push({ name: up.filename, reason: 'Not a Ren\u2019Py save, persistent file, or zip' })
      }
    }
    return report
  }

  private async importOne(saveDir: string, name: string, data: Buffer, report: ImportReport): Promise<void> {
    if (name.endsWith('.save') && !(await isRenpySave(data))) {
      report.skipped.push({ name, reason: 'Not a valid Ren\u2019Py save file' })
      return
    }
    await this.write(saveDir, name, data, { reason: 'import' })
    report.imported.push(name)
  }

  private async importBundle(saveDir: string, filename: string, data: Buffer, report: ImportReport): Promise<void> {
    const entries = await readZipEntries(data, () => true, SAVES_ZIP)
    const names = [...entries.keys()]
    // A zipped-up *single* save (its members at the root) is itself a save file.
    if (names.includes('log') && names.includes('renpy_version') && !names.some((n) => n.endsWith('.save'))) {
      await this.importOne(saveDir, basename(filename).replace(/\.zip$/i, '') + (filename.endsWith('.save') ? '' : '.save'), data, report)
      return
    }
    // Group candidate files by their parent folder.
    const groups = new Map<string, Array<[string, Buffer]>>()
    for (const [n, buf] of entries) {
      const clean = n.replace(/\\/g, '/')
      const b = basename(clean)
      if (b === 'security_keys.txt') {
        report.trustedKeys += await this.mergeSecurityKeys(buf.toString('utf-8'))
        continue
      }
      if (!(b.endsWith('.save') || b === 'persistent')) continue
      const parent = dirname(clean) === '.' ? '' : basename(dirname(clean))
      if (!groups.has(parent)) groups.set(parent, [])
      groups.get(parent)!.push([b, buf])
    }
    if (!groups.size) {
      report.skipped.push({ name: filename, reason: 'No save files found in zip' })
      return
    }
    // Prefer the folder named after this game's save directory; then root/"saves"; then a single folder.
    let chosen: Array<[string, Buffer]> | undefined = groups.get(saveDir)
    if (!chosen) {
      const generic = ['', 'saves'].map((k) => groups.get(k)).find(Boolean)
      if (generic) chosen = generic
      else if (groups.size === 1) chosen = [...groups.values()][0]
    }
    if (!chosen) {
      report.skipped.push({
        name: filename,
        reason: `Zip contains saves for other games (${[...groups.keys()].join(', ')}), none for ${saveDir}`,
      })
      return
    }
    for (const [n, buf] of chosen) await this.importOne(saveDir, n, buf, report)
  }
}

export interface ImportReport {
  imported: string[]
  skipped: Array<{ name: string; reason: string }>
  trustedKeys: number
}

/**
 * Why a version went to History, and whether that version is the only copy of something. The
 * table names every reason, so a new one has to decide: an only copy stays at least 30 days however
 * many versions follow it.
 */
const ONLY_COPY = {
  // The game's own saving and a plain overwrite: the person's earlier save, kept by the version limit.
  game: false,
  overwrite: false,
  // The older of two saves from two devices.
  conflict: true,
  delete: true,
  'game-delete': true,
  'user-delete': true,
  // What an import, a restore, a sync code or a copy replaced.
  import: true,
  'user-import': true,
  restore: true,
  sync: true,
  copy: true,
  'user-copy': true,
  // A merge of save keys keeps every earlier key, so the old file is no only copy.
  'merge-keys': false,
} as const satisfies Record<string, boolean>
export type SaveReason = keyof typeof ONLY_COPY
const ONLY_COPIES = new Set(Object.keys(ONLY_COPY).filter((r) => ONLY_COPY[r as SaveReason]))
const KEEP_ONLY_COPIES = 30 * 24 * 3600_000

/** The runtime's FNV-1a hash of a file, as it names an upload: "<hex>:<length>". */
export function fnv(data: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}:${data.length}`
}

function clampMtime(ms?: number): number {
  const now = Date.now()
  if (!ms || !Number.isFinite(ms) || ms <= 0 || ms > now + 60_000) return now
  return Math.floor(ms)
}
