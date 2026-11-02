import { readdir, statfs } from 'node:fs/promises'
import { Router } from 'express'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import type { JobManager } from '../jobs.js'
import type { SdkManager } from '../pipeline/sdk.js'
import { HttpError } from '../util/paths.js'

async function disk(path: string) {
  try {
    const s = await statfs(path)
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }
  } catch {
    return null
  }
}

export function createSystemRouter(cfg: Config, db: Db, jobs: JobManager, sdk: SdkManager, version: string): Router {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime(), version })
  })

  /** Held open by the job runner (through the scale-to-zero proxy) to keep the pod alive. */
  router.get('/keepalive', async (req, res) => {
    const hold = Math.min(120, Math.max(0, Number(req.query['hold']) || 0))
    await new Promise((r) => setTimeout(r, hold * 1000))
    res.json({ ok: true, busy: jobs.isBusy() })
  })

  router.get('/system', async (_req, res) => {
    let engines: string[] = []
    try {
      engines = (await readdir(cfg.enginesDir)).filter((n) => !n.startsWith('.') && !n.includes('.tmp'))
    } catch {}
    const games = db.allGames()
    res.json({
      version,
      sdk: { version: cfg.sdkVersion, installed: await sdk.installed() },
      engines,
      disk: { games: await disk(cfg.gamesDir), data: await disk(cfg.dataDir) },
      library: {
        games: games.length,
        installed: games.filter((g) => g.status === 'installed').length,
        bytes: games.reduce((n, g) => n + (g.size_bytes || 0), 0),
      },
      paths: { games: cfg.gamesDir, archives: cfg.archivesDir, data: cfg.dataDir },
      busy: jobs.isBusy(),
    })
  })

  router.post('/system/sdk', (_req, res) => {
    res.json({ jobId: jobs.enqueue('install-sdk', '', {}) })
  })

  // ---- jobs ---------------------------------------------------------------

  router.get('/jobs', (req, res) => {
    const limit = Math.min(200, Number(req.query['limit']) || 30)
    res.json({
      jobs: db.listJobs(limit).map((j) => ({
        id: j.id,
        type: j.type,
        slug: j.slug,
        status: j.status,
        stage: j.stage,
        progress: j.progress,
        message: j.message,
        error: j.error || null,
        params: safeParams(j.params),
        result: j.status === 'done' ? safeJson(j.result) : null,
        createdAt: j.created_at,
        startedAt: j.started_at || null,
        finishedAt: j.finished_at || null,
      })),
      busy: jobs.isBusy(),
    })
  })

  router.get('/jobs/:id/log', (req, res) => {
    const j = db.getJob(req.params.id)
    if (!j) throw new HttpError(404, 'Job not found')
    res.type('text/plain').send(jobs.getLog(j.id))
  })

  router.post('/jobs/:id/cancel', (req, res) => {
    if (!jobs.cancel(req.params.id)) throw new HttpError(409, 'Job is not running or queued')
    res.json({ ok: true })
  })

  router.post('/jobs/:id/retry', (req, res) => {
    const id = jobs.retry(req.params.id)
    if (!id) throw new HttpError(409, 'Job cannot be retried')
    res.json({ jobId: id })
  })

  router.delete('/jobs', (_req, res) => {
    db.deleteFinishedJobs()
    res.json({ ok: true })
  })

  return router
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function safeParams(s: string): unknown {
  const p = safeJson(s) as Record<string, any> | null
  if (!p) return null
  return { source: p.source, slug: p.slug, path: p.path }
}
