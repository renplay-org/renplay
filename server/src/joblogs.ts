import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export const JOB_LOG_LIMIT = 96 * 1024

/** Two capped files per job. Synchronous appends reach the OS before log() returns,
 * so killing the process cannot lose a JavaScript/WriteStream backlog. */
export class JobLogs {
  private readonly dir: string

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'job-logs')
    mkdirSync(this.dir, { recursive: true })
  }

  append(id: string, line: string): void {
    const path = this.path(id)
    const data = Buffer.from(line)
    const tail = data.subarray(Math.max(0, data.length - JOB_LOG_LIMIT))
    const size = existsSync(path) ? statSync(path).size : 0
    if (size + tail.length > JOB_LOG_LIMIT) renameSync(path, `${path}.1`)
    appendFileSync(path, tail)
  }

  read(id: string): string | null {
    const path = this.path(id)
    const parts: Buffer[] = []
    for (const file of [`${path}.1`, path]) {
      if (existsSync(file)) parts.push(readFileSync(file))
    }
    if (!parts.length) return null
    const data = Buffer.concat(parts)
    return data.subarray(Math.max(0, data.length - JOB_LOG_LIMIT)).toString('utf-8')
  }

  /** Called after clearing jobs and at startup, including leftovers of a crashed cleanup. */
  clean(exists: (id: string) => boolean): void {
    for (const name of readdirSync(this.dir)) {
      const match = name.match(/^([a-zA-Z0-9_-]+)\.log(?:\.1)?$/)
      if (match && !exists(match[1]!)) unlinkSync(join(this.dir, name))
    }
  }

  private path(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid job id')
    return join(this.dir, `${id}.log`)
  }
}
