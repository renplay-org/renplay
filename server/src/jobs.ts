import { keepaliveToken } from './auth.js'
import { viewers } from './accounts-context.js'
import http from 'node:http'
import https from 'node:https'
import type { Config } from './config.js'
import { parseJson, type Db, type JobRow } from './db.js'
import { newId } from './util/fsx.js'
import { JOB_LOG_LIMIT, JobLogs } from './joblogs.js'

export interface JobContext<P = any> {
  id: string
  params: P
  signal: AbortSignal
  /** Reports progress (0..1) within the current stage. */
  progress(stage: string, fraction?: number, message?: string): void
  log(line: string): void
  checkAbort(): void
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>

export class JobManager {
  private handlers = new Map<string, JobHandler>()
  private running: { id: string; abort: AbortController } | null = null
  private logs: JobLogs
  private liveLog = ''
  private logWriteFailed = false
  private pending: Partial<JobRow> & { id?: string } = {}
  private flushTimer: NodeJS.Timeout | null = null
  private keepalive: { stop: () => void } | null = null
  listeners = new Set<() => void>()

  constructor(
    private readonly db: Db,
    private readonly cfg: Config,
  ) {
    this.logs = new JobLogs(cfg.dataDir)
  }

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler)
  }

  /** Marks jobs left running by a previous process and resumes the queue. */
  start(): void {
    this.logs.clean((id) => !!this.db.getJob(id))
    for (const j of this.db.listJobs(500)) {
      if (j.status === 'running') {
        this.db.updateJob(j.id, {
          status: 'interrupted',
          error: 'Renplay restarted while this job was running',
          finished_at: new Date().toISOString(),
        })
      }
    }
    void this.pump()
  }

  enqueue(type: string, game: string, params: unknown): string {
    if (!this.handlers.has(type)) throw new Error(`Unknown job type ${type}`)
    const id = newId('j')
    this.db.insertJob({ id, type, game, params: JSON.stringify(params ?? {}) })
    this.notify()
    // Installs are shared work, not extensions of the enqueuing user's permissions.
    viewers.exit(() => void this.pump())
    return id
  }

  /** Returns the active (queued or running) job of a game. */
  activeFor(game: string): JobRow | null {
    return this.db.listJobs(200).find((j) => j.game === game && (j.status === 'queued' || j.status === 'running')) ?? null
  }

  cancel(id: string): boolean {
    const job = this.db.getJob(id)
    if (!job) return false
    if (job.status === 'queued') {
      this.db.updateJob(id, { status: 'cancelled', finished_at: new Date().toISOString() })
      this.notify()
      return true
    }
    if (job.status === 'running' && this.running?.id === id) {
      this.running.abort.abort(new Error('Cancelled'))
      return true
    }
    return false
  }

  retry(id: string): string | null {
    const job = this.db.getJob(id)
    if (!job || job.status === 'queued' || job.status === 'running') return null
    return this.enqueue(job.type, job.game, parseJson(job.params, {}))
  }

  getLog(id: string): string {
    if (this.running?.id === id) return this.liveLog
    return this.db.getJob(id)?.log || this.logs.read(id) || ''
  }

  clearFinished(): void {
    this.db.deleteFinishedJobs()
    this.logs.clean((id) => !!this.db.getJob(id))
  }

  isBusy(): boolean {
    return this.running !== null
  }

  private notify() {
    for (const l of this.listeners) l()
  }

  private async pump(): Promise<void> {
    if (this.running) return
    const next = this.db
      .listJobs(500)
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
    if (!next) {
      this.keepalive?.stop()
      this.keepalive = null
      return
    }
    const handler = this.handlers.get(next.type)
    const abort = new AbortController()
    this.running = { id: next.id, abort }
    this.liveLog = ''
    this.logWriteFailed = false
    this.keepalive ??= startKeepalive(this.cfg)
    this.db.updateJob(next.id, { status: 'running', started_at: new Date().toISOString(), stage: 'Starting', progress: 0 })
    this.notify()

    const ctx: JobContext = {
      id: next.id,
      params: parseJson(next.params, {}),
      signal: abort.signal,
      progress: (stage, fraction, message) => {
        this.pending = { ...this.pending, id: next.id, stage, progress: fraction ?? 0, message: message ?? '' }
        this.scheduleFlush()
      },
      log: (line) => {
        // Local time of the server (TZ), as people read the log.
        const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false })
        const text = `[${stamp}] ${line}\n`
        this.liveLog = (this.liveLog + text).slice(-JOB_LOG_LIMIT)
        try {
          this.logs.append(next.id, text)
        } catch (err) {
          // A full disk must not turn a log message into an unhandled job failure.
          if (!this.logWriteFailed) console.error(`Could not persist job ${next.id} log:`, err)
          this.logWriteFailed = true
        }
      },
      checkAbort: () => {
        if (abort.signal.aborted) throw abort.signal.reason ?? new Error('Cancelled')
      },
    }

    try {
      if (!handler) throw new Error(`No handler for ${next.type}`)
      const result = await handler(ctx)
      this.flush()
      this.db.updateJob(next.id, {
        status: 'done',
        progress: 1,
        stage: 'Done',
        result: JSON.stringify(result ?? {}),
        log: this.getLog(next.id),
        finished_at: new Date().toISOString(),
      })
    } catch (e) {
      this.flush()
      const cancelled = abort.signal.aborted
      const msg = e instanceof Error ? e.message : String(e)
      ctx.log(`${cancelled ? 'Cancelled' : 'Failed'}: ${msg}`)
      if (!cancelled && e instanceof Error && e.stack) console.error(`job ${next.id} (${next.type}) failed:`, e.stack)
      this.db.updateJob(next.id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: msg,
        log: this.getLog(next.id),
        finished_at: new Date().toISOString(),
      })
    } finally {
      this.liveLog = ''
      this.running = null
      this.notify()
      setImmediate(() => void this.pump())
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => this.flush(), 400)
  }

  private flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    const { id, ...rest } = this.pending
    this.pending = {}
    if (id) {
      this.db.updateJob(id, rest)
      this.notify()
    }
  }
}

/**
 * Keeps a scale-to-zero deployment awake while jobs run by holding a request
 * open through the HTTP proxy that counts in-flight requests.
 */
function startKeepalive(cfg: Config): { stop: () => void } {
  if (!cfg.keepaliveUrl) return { stop: () => {} }
  let stopped = false
  let req: http.ClientRequest | null = null
  const loop = () => {
    if (stopped) return
    const url = new URL('/api/keepalive?hold=120', cfg.keepaliveUrl)
    const mod = url.protocol === 'https:' ? https : http
    req = mod.request(
      url,
      { method: 'GET', headers: { authorization: `Bearer ${keepaliveToken}`, ...(cfg.keepaliveHost ? { host: cfg.keepaliveHost } : {}) }, timeout: 150_000 },
      (res) => {
        res.resume()
        res.on('end', () => setTimeout(loop, 500))
      },
    )
    req.on('error', () => setTimeout(loop, 5000))
    req.on('timeout', () => req?.destroy())
    req.end()
  }
  loop()
  return {
    stop: () => {
      stopped = true
      req?.destroy()
    },
  }
}
