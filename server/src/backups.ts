import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import yazl from 'yazl'
import type { Config } from './config.js'
import type { Db } from './db.js'

const DAY = 24 * 3600_000
/** saves-YYYY-MM-DD-HHMMSS.zip, or HHMM as the first backups were named. */
const NAME = /^saves-(\d{4}-\d{2}-\d{2}-\d{4}(?:\d{2})?)\.zip$/

export interface BackupInfo {
  /** Where backups go, or null when they are off. */
  dir: string | null
  keep: number
  files: Array<{ name: string; size: number; at: number }>
  last: number | null
  /** When the next backup is due. Renplay runs it then, or the next time it runs after. */
  next: number | null
  running: boolean
  error: string | null
}

/** Every file under a folder, as paths relative to it. */
async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(root, path)))
    else if (entry.isFile()) out.push(relative(root, path))
  }
  return out
}

const stamp = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`

/**
 * Save backups: once a day, a zip of everyone's saves (not their history, which stays in the data
 * folder) in the backups folder, keeping the last few. A server that sleeps when idle catches up
 * the next time it runs. Saves are only read here, never changed.
 */
export class SaveBackups {
  private running: Promise<string> | null = null
  private error: string | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
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

  async info(): Promise<BackupInfo> {
    const files = await this.files()
    const last = files[0]?.at ?? null
    return { dir: this.dir, keep: this.cfg.backupKeep, files, last, next: this.dir ? (last ? last + DAY : Date.now()) : null, running: !!this.running, error: this.error }
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
    try {
      await mkdir(dir, { recursive: true })
      const name = `saves-${stamp(new Date())}.zip`
      const temp = join(dir, `.${name}.part`)
      const zip = new yazl.ZipFile()
      const done = new Promise<void>((resolve, reject) => {
        const out = createWriteStream(temp)
        out.on('close', resolve)
        out.on('error', reject)
        zip.outputStream.pipe(out)
      })
      const users = this.db.raw.prepare('SELECT id, username FROM users ORDER BY id').all() as Array<{ id: number; username: string }>
      let count = 0
      for (const u of users) {
        const root = join(this.cfg.dataDir, 'users', String(u.id), 'saves')
        for (const rel of await walk(root)) {
          const st = await stat(join(root, rel)).catch(() => null)
          if (!st) continue
          zip.addFile(join(root, rel), `${u.id}-${u.username}/${rel.split('\\').join('/')}`, { mtime: st.mtime })
          count++
        }
      }
      zip.addBuffer(Buffer.from(`Renplay save backup, ${new Date().toISOString()}.\n${count} files: each person's saves under <id>-<username>/<save folder>/.\nTo restore a game's saves, import its folder from the game's page, under Saves.\n`), 'README.txt')
      zip.end()
      await done
      await rename(temp, join(dir, name))
      // Keep the newest few.
      for (const old of (await this.files()).slice(this.cfg.backupKeep)) await rm(join(dir, old.name), { force: true })
      this.error = null
      return name
    } catch (e) {
      this.error = (e as Error).message
      throw e
    }
  }

  /** The path of one backup, for downloading it. */
  path(name: string): string | null {
    return this.dir && NAME.test(name) ? join(this.dir, name) : null
  }
}
