import { spawn } from 'node:child_process'
import { mkdir, readdir, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { exists } from './fsx.js'

/**
 * Deletes directories without blocking the server. A path is first renamed
 * into the purge folder (instant, same filesystem), then removed by a
 * low-priority `rm -rf` child process, one at a time. Deleting in-process
 * would occupy Node's file I/O thread pool for as long as the delete takes,
 * which on NFS can be many minutes. Whatever is left (NFS keeps files that are
 * still open around) is retried later and on the next start.
 */
export class Purger {
  private queue: string[] = []
  private running = false
  private retryTimer: NodeJS.Timeout | null = null

  constructor(private readonly dir: string) {}

  async purge(path: string): Promise<void> {
    if (!(await exists(path))) return
    await mkdir(this.dir, { recursive: true })
    const dest = join(this.dir, `${basename(path)}.${Date.now().toString(36)}`)
    await rename(path, dest)
    this.enqueue(dest)
  }

  /** Queues everything already in the purge folder. */
  async resume(): Promise<void> {
    let names: string[] = []
    try {
      names = await readdir(this.dir)
    } catch {
      return
    }
    for (const n of names) this.enqueue(join(this.dir, n))
  }

  pending(): number {
    return this.queue.length + (this.running ? 1 : 0)
  }

  private enqueue(path: string) {
    if (!this.queue.includes(path)) this.queue.push(path)
    void this.next()
  }

  private async next(): Promise<void> {
    if (this.running) return
    const path = this.queue.shift()
    if (!path) return
    this.running = true
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn('nice', ['-n', '19', 'rm', '-rf', '--', path], { stdio: 'ignore' })
      p.on('error', () => resolve(false))
      p.on('close', (code) => resolve(code === 0))
    })
    this.running = false
    if (!ok && !this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void this.resume()
      }, 10 * 60_000)
      this.retryTimer.unref()
    }
    void this.next()
  }
}
