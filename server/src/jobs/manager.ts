import { viewers } from '../accounts/context.js'
import type { Config } from '../config.js'
import { parseJson, type Db, type JobRow } from '../db.js'
import { newId } from '../util/fsx.js'
import { log, took } from '../util/log.js'
import { startKeepalive } from './keepalive.js'
import { JOB_LOG_LIMIT, JobLogs } from './logs.js'

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
  private handlers = new Map<string, { name: string; run: JobHandler }>()
  private running: { id: string; abort: AbortController; pausing: boolean } | null = null
  private logs: JobLogs
  private liveLog = ''
  private logWriteFailed = false
  private pending: Partial<JobRow> & { id?: string } = {}
  private flushTimer: NodeJS.Timeout | null = null
  private keepalive: { stop: () => void } | null = null

  constructor(
    private readonly db: Db,
    private readonly cfg: Config,
  ) {
    this.logs = new JobLogs(cfg.dataDir)
  }

  /** Adds a kind of job. `name` is how the log calls it, like Install. */
  register(type: string, name: string, run: JobHandler): void {
    this.handlers.set(type, { name, run })
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

  enqueue(type: string, game: string, params: unknown, retryOf = ''): string {
    if (!this.handlers.has(type)) throw new Error(`Unknown job type ${type}`)
    const id = newId('j')
    this.db.insertJob({ id, type, game, params: JSON.stringify(params ?? {}), retry_of: retryOf })
    // Installs are shared work, not extensions of the enqueuing user's permissions.
    viewers.exit(() => void this.pump())
    return id
  }

  /** Returns the active (queued, paused or running) job of a game. */
  activeFor(game: string): JobRow | null {
    return this.db.listJobs(200).find((j) => j.game === game && (j.status === 'queued' || j.status === 'paused' || j.status === 'running')) ?? null
  }

  cancel(id: string): boolean {
    const job = this.db.getJob(id)
    if (!job) return false
    if (job.status === 'queued' || job.status === 'paused') {
      this.db.updateJob(id, { status: 'cancelled', finished_at: new Date().toISOString() })
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
    if (!job || job.status === 'queued' || job.status === 'paused' || job.status === 'running') return null
    return this.enqueue(job.type, job.game, parseJson(job.params, {}), job.id)
  }

  /**
   * Holds a job back. A queued one stays in the queue and is skipped. A running one stops the way a
   * cancel does and goes back to the front of the queue as paused. Resuming starts it again from its
   * parameters: an install reads its archive again, since a build is only kept once it is whole.
   */
  pause(id: string): boolean {
    const job = this.db.getJob(id)
    if (!job) return false
    if (job.status === 'queued') {
      this.db.updateJob(id, { status: 'paused' })
      return true
    }
    if (job.status === 'running' && this.running?.id === id && !this.running.pausing) {
      this.running.pausing = true
      this.running.abort.abort(new Error('Paused'))
      return true
    }
    return false
  }

  resume(id: string): boolean {
    if (this.db.getJob(id)?.status !== 'paused') return false
    this.db.updateJob(id, { status: 'queued' })
    viewers.exit(() => void this.pump())
    return true
  }

  /** Moves a waiting job one place earlier or later in the queue, or to the front. */
  move(id: string, to: 'up' | 'down' | 'first'): boolean {
    const waiting = this.db.waitingJobs().map((j) => j.id)
    const at = waiting.indexOf(id)
    if (at < 0) return false
    waiting.splice(at, 1)
    waiting.splice(to === 'first' ? 0 : Math.max(0, Math.min(waiting.length, at + (to === 'up' ? -1 : 1))), 0, id)
    waiting.forEach((jobId, i) => this.db.updateJob(jobId, { position: i + 1 }))
    return true
  }

  /** A job's log. Jobs from before 2.11 have it only in the database. */
  getLog(id: string): string {
    if (this.running?.id === id) return this.liveLog
    return this.logs.read(id) ?? this.db.getJob(id)?.log ?? ''
  }

  /** Clears finished jobs, except those `keep` keeps (jobs a person at Off cannot see). */
  clearFinished(keep?: (job: JobRow) => boolean): void {
    this.db.deleteFinishedJobs(keep)
    this.logs.clean((id) => !!this.db.getJob(id))
  }

  isBusy(): boolean {
    return this.running !== null
  }

  private async pump(): Promise<void> {
    if (this.running) return
    const next = this.db
      .waitingJobs()
      .find((j) => j.status === 'queued')
    if (!next) {
      this.keepalive?.stop()
      this.keepalive = null
      return
    }
    const handler = this.handlers.get(next.type)
    const abort = new AbortController()
    const running = { id: next.id, abort, pausing: false }
    this.running = running
    this.liveLog = ''
    this.logWriteFailed = false
    this.keepalive ??= startKeepalive(this.cfg)
    this.db.updateJob(next.id, { status: 'running', started_at: new Date().toISOString(), stage: 'Starting', progress: 0 })
    const started = Date.now()
    const what = `${handler?.name ?? next.type}${next.game ? ` of ${next.game}` : ''}`
    log('job', `${what} started`)

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
        // At debug the pod log follows each job as it runs.
        log('job', line, 'debug')
        this.liveLog = (this.liveLog + text).slice(-JOB_LOG_LIMIT)
        try {
          this.logs.append(next.id, text)
        } catch (err) {
          // A full disk must not turn a log message into an unhandled job failure.
          if (!this.logWriteFailed) console.error(`job: Could not keep the log of job ${next.id}: ${(err as Error).message}`)
          this.logWriteFailed = true
        }
      },
      checkAbort: () => {
        if (abort.signal.aborted) throw abort.signal.reason ?? new Error('Cancelled')
      },
    }

    try {
      if (!handler) throw new Error(`No handler for ${next.type}`)
      const result = await handler.run(ctx)
      this.flush()
      this.db.updateJob(next.id, {
        status: 'done',
        progress: 1,
        stage: 'Done',
        result: JSON.stringify(result ?? {}),
        finished_at: new Date().toISOString(),
      })
      log('job', `${what} finished in ${took(Date.now() - started)}`)
    } catch (e) {
      this.flush()
      const cancelled = abort.signal.aborted
      const msg = e instanceof Error ? e.message : String(e)
      if (cancelled && running.pausing) {
        // Back to the front of the queue as paused, as if it had not started.
        ctx.log('Paused. Resuming starts again from the archive.')
        log('job', `${what} paused`)
        this.db.updateJob(next.id, { status: 'paused', stage: 'Paused', progress: 0, message: '', error: '', started_at: '', finished_at: '', position: -1 })
        return
      }
      ctx.log(`${cancelled ? 'Cancelled' : 'Failed'}: ${msg}`)
      if (cancelled) log('job', `${what} cancelled`)
      else log('job', `${what} failed after ${took(Date.now() - started)}: ${msg}`, 'error')
      if (!cancelled && e instanceof Error && e.stack) log('job', e.stack, 'debug')
      this.db.updateJob(next.id, {
        status: cancelled ? 'cancelled' : 'failed',
        error: msg,
        finished_at: new Date().toISOString(),
      })
    } finally {
      this.liveLog = ''
      this.running = null
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
    if (id) this.db.updateJob(id, rest)
  }
}
