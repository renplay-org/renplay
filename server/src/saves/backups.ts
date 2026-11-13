import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import yazl from 'yazl'
import { walkFiles } from '../util/fsx.js'
import { log, stamp } from '../util/log.js'
import { bytes } from '../shared/format.js'
import { copyDatabase } from '../util/database.js'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import type { SaveStores } from './stores.js'
import type { BackupInfo } from '../shared/api.js'

const DAY = 24 * 3600_000
/** saves-YYYY-MM-DD-HHMMSS.zip, or HHMM as the first backups were named. */
const NAME = /^saves-(\d{4}-\d{2}-\d{2}-\d{4}(?:\d{2})?)\.zip$/

/**
 * Daily backups: everyone's saves (not their history) and a consistent copy of the library database.
 * A server that sleeps when idle catches up the next time it runs. Saves are only read, never changed.
 */
export class SaveBackups {
  private running: Promise<string> | null = null
  private error: string | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
    private readonly saveStores: SaveStores,
  ) {}

  get dir(): string | null {
    return this.cfg.backupDir
  }

  start(): void {
    if (!this.dir) return
    const check = () => void this.runIfDue().catch(() => {})
    setTimeout(check, 60_000).unref()
    this.timer = setInterval(check, 3600_000)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private async files(): Promise<BackupInfo['files']> {
    if (!this.dir) return []
    const names = (await readdir(this.dir).catch(() => [] as string[])).filter((n) => NAME.test(n)).sort().reverse()
    return Promise.all(names.map(async (name) => {
      const st = await stat(join(this.dir!, name))
      return { name, size: st.size, at: st.mtimeMs }
    }))
  }

  private get libraryDir(): string {
    // Migration copies remain mandatory even when daily backups are off.
    return join(this.dir ?? join(this.cfg.dataDir, 'backups', 'saves'), 'library')
  }

  private async libraryFiles(): Promise<Array<{ name: string; size: number; at: number }>> {
    const names = (await readdir(this.libraryDir).catch(() => [] as string[])).filter((n) => /^library-.+\.db$/.test(n))
    const files = await Promise.all(names.map(async (name) => {
      const st = await stat(join(this.libraryDir, name))
      return { name, size: st.size, at: st.mtimeMs }
    }))
    return files.sort((a, b) => b.at - a.at || b.name.localeCompare(a.name))
  }

  async info(): Promise<BackupInfo> {
    const files = await this.files()
    const newest = (await this.libraryFiles())[0]
    const library = newest ? { path: join(this.libraryDir, newest.name), size: newest.size, at: newest.at } : null
    const last = files[0]?.at ?? null
    return { dir: this.dir, keep: this.cfg.backupKeep, files, library, last, next: this.dir ? (last ? last + DAY : Date.now()) : null, running: !!this.running, error: this.error }
  }

  async runIfDue(): Promise<string | null> {
    const { next } = await this.info()
    if (next === null || next > Date.now()) return null
    return this.run()
  }

  /** Writes one backup now (or waits for the one running) and returns its file name. */
  run(): Promise<string> {
    if (!this.dir) return Promise.reject(new Error('Save backups are off'))
    this.running ??= this.write().finally(() => (this.running = null))
    return this.running
  }

  private async write(): Promise<string> {
    const dir = this.dir!
    const name = `saves-${stamp().replace(' ', '-').replaceAll(':', '')}.zip`
    const temp = join(dir, `.${name}.part`)
    let out: ReturnType<typeof createWriteStream> | null = null
    try {
      await mkdir(dir, { recursive: true })
      const library = copyDatabase(this.db.raw, this.libraryDir)
      const zip = new yazl.ZipFile()
      // A full disk or an unwritable folder rejects this while files are still being added: it is
      // awaited below, and handled now so it never goes unhandled.
      const done = new Promise<void>((resolve, reject) => {
        out = createWriteStream(temp)
        out.on('close', resolve)
        out.on('error', reject)
        zip.outputStream.on('error', reject)
        zip.outputStream.pipe(out)
      })
      done.catch(() => {})
      const users = this.db.raw.prepare('SELECT id, username FROM users ORDER BY id').all() as Array<{ id: number; username: string }>
      let count = 0
      for (const u of users) {
        const root = join(this.saveStores.folder(u.id), 'saves')
        for (const f of await walkFiles(root)) {
          zip.addFile(f.full, `${u.id}-${u.username}/${f.rel}`, { mtime: new Date(f.mtimeMs) })
          count++
        }
      }
      zip.addBuffer(Buffer.from(`Renplay save backup, ${new Date().toISOString()}.\n${count} files: each person's saves under <id>-<username>/<save folder>/.\nTo restore a game's saves, import its folder from the game's page, under Saves.\n`), 'README.txt')
      zip.end()
      await done
      await rename(temp, join(dir, name))
      for (const old of (await this.files()).slice(this.cfg.backupKeep)) await rm(join(dir, old.name), { force: true })
      const daily = (await this.libraryFiles()).filter((f) => !f.name.startsWith('library-before-')).sort((a, b) => b.name.localeCompare(a.name))
      for (const old of daily.slice(this.cfg.backupKeep)) await rm(join(this.libraryDir, old.name), { force: true })
      this.error = null
      log('backup', `Library database backed up: ${library}`)
      log('backup', `Saves backed up: ${name}, ${count} ${count === 1 ? 'file' : 'files'}, ${bytes((await stat(join(dir, name))).size)}`)
      return name
    } catch (e) {
      ;(out as ReturnType<typeof createWriteStream> | null)?.destroy()
      await rm(temp, { force: true }).catch(() => {})
      this.error = (e as Error).message
      log('backup', `Saves not backed up: ${this.error}`, 'error')
      throw e
    }
  }

  /** The path of one backup, for downloading it. */
  path(name: string): string | null {
    return this.dir && NAME.test(name) ? join(this.dir, name) : null
  }
}
