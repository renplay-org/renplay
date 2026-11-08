import { Router } from 'express'
import { parseJson, type JobRow } from '../db.js'
import type { Services } from '../services.js'
import { HttpError, cleanRelPath } from '../util/paths.js'
import { keepaliveToken } from './keepalive.js'

/** The job queue as people see it, and the keepalive request a running job holds open. */
export function createJobsRouter(s: Services): Router {
  const { db, jobs, content, catalog } = s
  const router = Router({ caseSensitive: true, strict: true })

  /**
   * Off: a job about an adult game does not exist either. A job names its game when it has one;
   * a first install or a hash has only its download and recipe, and a forgotten game only its id.
   */
  const jobHidden = (j: Pick<JobRow, 'game' | 'params' | 'result'>): boolean => {
    if (content.viewerLevel() !== 'off') return false
    const game = j.game ? db.getGame(j.game) : null
    if (game) return content.hides(game)
    const params = parseJson<{ recipeId?: unknown; path?: unknown; source?: { path?: unknown } }>(j.params, {})
    const result = parseJson<{ recipe?: unknown; game?: unknown } | null>(j.result, null)
    const ids = [j.game, params.recipeId, result?.recipe, result?.game].filter((x): x is string => typeof x === 'string' && x !== '')
    if (ids.some((id) => catalog.isAdultId(id))) return true
    const archive = [params.source?.path, params.path].find((x): x is string => typeof x === 'string' && x !== '')
    if (!archive) return false
    try {
      return catalog.archiveHidden(cleanRelPath(archive))
    } catch {
      return false
    }
  }

  router.get('/keepalive', (req, res) => {
    if (req.get('authorization') !== `Bearer ${keepaliveToken}`) throw new HttpError(401, 'Invalid keepalive token')
    const hold = Math.min(150, Math.max(0, Number(req.query['hold']) || 0))
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
    res.flushHeaders()
    const tick = setInterval(() => res.write('.'), 10_000)
    const done = setTimeout(() => {
      clearInterval(tick)
      res.end(jobs.isBusy() ? 'busy\n' : 'idle\n')
    }, hold * 1000)
    req.on('close', () => {
      clearInterval(tick)
      clearTimeout(done)
    })
  })

  router.get('/jobs', (req, res) => {
    const pageNumber = (value: unknown, fallback: number): number => {
      if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback
      const n = Number(value)
      return Number.isSafeInteger(n) ? n : fallback
    }
    const limit = Math.max(1, Math.min(200, pageNumber(req.query['limit'], 30)))
    const offset = pageNumber(req.query['offset'], 0)
    // Off: hidden jobs are left out before paging, so pages, the total and busy only count what this person may see.
    const visible = content.viewerLevel() === 'off' ? db.listJobs(Number.MAX_SAFE_INTEGER, 0).filter((j) => !jobHidden(j)) : null
    const page = visible ? visible.slice(offset, offset + limit) : db.listJobs(limit, offset)
    res.json({
      jobs: page.map((j) => ({
        id: j.id,
        type: j.type,
        game: j.game,
        status: j.status,
        stage: j.stage,
        progress: j.progress,
        message: j.message,
        error: j.error || null,
        params: safeParams(j.params),
        result: j.status === 'done' ? parseJson(j.result, null) : null,
        createdAt: j.created_at,
        startedAt: j.started_at || null,
        finishedAt: j.finished_at || null,
      })),
      busy: visible ? visible.some((j) => j.status === 'running') : jobs.isBusy(),
      total: visible ? visible.length : db.countJobs(),
    })
  })

  /** The job, unless it belongs to a game that does not exist for this person. */
  const visibleJob = (id: string) => {
    const j = db.getJob(id)
    if (!j || jobHidden(j)) throw new HttpError(404, 'Job not found')
    return j
  }

  router.get('/jobs/:id/log', (req, res) => {
    const j = visibleJob(req.params.id)
    res.type('text/plain').send(jobs.getLog(j.id))
  })

  router.post('/jobs/:id/cancel', (req, res) => {
    visibleJob(req.params.id)
    if (!jobs.cancel(req.params.id)) throw new HttpError(409, 'Job is not running or queued')
    res.json({ ok: true })
  })

  router.post('/jobs/:id/retry', (req, res) => {
    visibleJob(req.params.id)
    const id = jobs.retry(req.params.id)
    if (!id) throw new HttpError(409, 'Job cannot be retried')
    res.json({ jobId: id })
  })

  router.delete('/jobs', (_req, res) => {
    // An admin at Off clears what they can see. The jobs about hidden games stay.
    jobs.clearFinished(content.viewerLevel() === 'off' ? (j) => jobHidden(j) : undefined)
    res.json({ ok: true })
  })

  return router
}

function safeParams(s: string): unknown {
  const p = parseJson<Record<string, any> | null>(s, null)
  if (!p) return null
  return { source: p.source, game: p.game, path: p.path, by: typeof p.by === 'number' ? p.by : undefined }
}
