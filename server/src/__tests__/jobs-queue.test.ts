import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'
import { JobManager } from '../jobs/manager.js'
import { createJobsRouter } from '../jobs/routes.js'
import type { Job } from '../shared/api.js'

const CATALOG = {
  recipe: (id: string) => (id === 'pale' ? { id, title: 'Pale Carnations' } : null),
  match: (a: { name: string }) => (a.name.endsWith('PaleCarnations-1.2-pc.zip') ? { recipe: { id: 'pale', title: 'Pale Carnations' } } : null),
  isAdultId: () => false,
  archiveHidden: () => false,
}

describe('the job queue', () => {
  let root: string
  let db: Db
  let jobs: JobManager
  let app: express.Express
  /** Open gates: a job named here runs until its gate is opened (or it is aborted). */
  let gates: Map<string, () => void>
  let started: string[]

  const cfg = () => ({ ...loadConfig(), dataDir: root, keepaliveUrl: '' })

  /** A manager on the same library, as after a restart. */
  function boot(): JobManager {
    const manager = new JobManager(db, cfg())
    manager.register('test', 'Test', (ctx) => {
      const name = String((ctx.params as { name?: string }).name)
      started.push(name)
      return new Promise((resolve, reject) => {
        gates.set(name, () => resolve({}))
        ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason))
      })
    })
    app = express()
    app.use(express.json())
    app.use('/api', createJobsRouter({ db, jobs: manager, catalog: CATALOG, content: { hides: () => false, viewerLevel: () => 'shown' } } as never))
    return manager
  }

  const list = async (): Promise<Job[]> => (await request(app).get('/api/jobs?limit=200').expect(200)).body.jobs
  const order = async () => (await list()).filter((j) => j.status === 'queued' || j.status === 'paused').map((j) => j.params?.path)
  const named = (name: string, game = '') => jobs.enqueue('test', game, { name, path: name })
  const settle = () => expect.poll(() => jobs.isBusy()).toBe(false)

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'renplay-queue-'))
    db = Db.open(root)
    gates = new Map()
    started = []
    jobs = boot()
  })

  afterEach(async () => {
    for (const open of gates.values()) open()
    await settle()
    await new Promise((resolve) => setImmediate(resolve))
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  describe('attempts', () => {
    it('counts only retries of the same job, not other jobs of one game', async () => {
      db.insertGame({ id: 'g', title: 'G' })
      // A mod added, a mod removed, a mod build: three jobs with the same type, game and parameters.
      const ids = ['a', 'b', 'c'].map((name) => jobs.enqueue('test', 'g', { game: 'g', name }))
      for (const [i, id] of ids.entries()) {
        await expect.poll(() => db.getJob(id)?.status).toBe('running')
        gates.get(['a', 'b', 'c'][i]!)!()
        await expect.poll(() => db.getJob(id)?.status).toBe('done')
      }
      const shown = await list()
      expect(shown).toHaveLength(3)
      expect(shown.map((j) => j.attempts)).toEqual([1, 1, 1])
    })

    it('shows a job that was retried once, with its attempts', async () => {
      db.insertGame({ id: 'g', title: 'G' })
      const first = jobs.enqueue('test', 'g', { game: 'g', name: 'x' })
      await expect.poll(() => db.getJob(first)?.status).toBe('running')
      jobs.cancel(first)
      await expect.poll(() => db.getJob(first)?.status).toBe('cancelled')
      const second = jobs.retry(first)!
      await expect.poll(() => db.getJob(second)?.status).toBe('running')
      jobs.cancel(second)
      await expect.poll(() => db.getJob(second)?.status).toBe('cancelled')
      const third = jobs.retry(second)!
      await expect.poll(() => db.getJob(third)?.status).toBe('running')
      const body = (await request(app).get('/api/jobs').expect(200)).body
      // The earlier attempts fold into the newest job, here and in the total.
      expect(body.jobs.map((j: Job) => [j.id, j.attempts])).toEqual([[third, 3]])
      expect(body.total).toBe(1)
    })
  })

  describe('order', () => {
    it('lists the queue in the order it will run', async () => {
      named('run')
      await expect.poll(() => started).toEqual(['run'])
      named('b')
      named('c')
      named('d')
      expect(await order()).toEqual(['b', 'c', 'd'])
    })

    it('moves a queued job up, down and to the front, and runs them so', async () => {
      named('run')
      await expect.poll(() => started).toEqual(['run'])
      const [b, c, d] = [named('b'), named('c'), named('d')] as [string, string, string]
      await request(app).post(`/api/jobs/${d}/move`).send({ to: 'up' }).expect(200)
      expect(await order()).toEqual(['b', 'd', 'c'])
      await request(app).post(`/api/jobs/${b}/move`).send({ to: 'down' }).expect(200)
      expect(await order()).toEqual(['d', 'b', 'c'])
      await request(app).post(`/api/jobs/${c}/move`).send({ to: 'first' }).expect(200)
      expect(await order()).toEqual(['c', 'd', 'b'])
      // At an end, a move changes nothing and still answers.
      await request(app).post(`/api/jobs/${c}/move`).send({ to: 'up' }).expect(200)
      await request(app).post(`/api/jobs/${b}/move`).send({ to: 'down' }).expect(200)
      expect(await order()).toEqual(['c', 'd', 'b'])
      for (const name of ['run', 'c', 'd', 'b']) {
        await expect.poll(() => started.at(-1)).toBe(name)
        gates.get(name)!()
      }
      await settle()
      expect(started).toEqual(['run', 'c', 'd', 'b'])
    })

    it('refuses a move of a job that is not waiting, an unknown place and an unknown job', async () => {
      const running = named('run')
      await expect.poll(() => started).toEqual(['run'])
      await request(app).post(`/api/jobs/${running}/move`).send({ to: 'up' }).expect(409)
      const b = named('b')
      await request(app).post(`/api/jobs/${b}/move`).send({ to: 'sideways' }).expect(400)
      await request(app).post('/api/jobs/nope/move').send({ to: 'up' }).expect(404)
    })

    it('keeps the order through a restart', async () => {
      named('run')
      await expect.poll(() => started).toEqual(['run'])
      named('b')
      const c = named('c')
      named('d')
      await request(app).post(`/api/jobs/${c}/move`).send({ to: 'first' }).expect(200)
      jobs = boot()
      jobs.start()
      // The job that was running is interrupted, as before; the queue starts with the one moved to the front.
      await expect.poll(() => started.at(-1)).toBe('c')
      expect(await order()).toEqual(['b', 'd'])
    })
  })

  describe('pause', () => {
    it('skips a paused job until it is resumed', async () => {
      named('run')
      await expect.poll(() => started).toEqual(['run'])
      const b = named('b')
      named('c')
      await request(app).post(`/api/jobs/${b}/pause`).expect(200)
      expect(db.getJob(b)?.status).toBe('paused')
      // It stays in the list, in its place.
      expect(await order()).toEqual(['b', 'c'])
      gates.get('run')!()
      await expect.poll(() => started.at(-1)).toBe('c')
      gates.get('c')!()
      await settle()
      expect(started).toEqual(['run', 'c'])
      expect(db.getJob(b)?.status).toBe('paused')
      await request(app).post(`/api/jobs/${b}/resume`).expect(200)
      await expect.poll(() => started.at(-1)).toBe('b')
    })

    it('stops a running job cleanly, keeps it as paused, and starts it again on resume', async () => {
      const run = named('run')
      await expect.poll(() => started).toEqual(['run'])
      const b = named('b')
      await request(app).post(`/api/jobs/${run}/pause`).expect(200)
      await expect.poll(() => db.getJob(run)?.status).toBe('paused')
      expect(db.getJob(run)).toMatchObject({ error: '', finished_at: '', started_at: '', progress: 0 })
      // The next job runs while it waits, and it is back at the front of the queue.
      await expect.poll(() => started.at(-1)).toBe('b')
      expect(await order()).toEqual(['run'])
      gates.get('b')!()
      await settle()
      expect(db.getJob(b)?.status).toBe('done')
      await request(app).post(`/api/jobs/${run}/resume`).expect(200)
      await expect.poll(() => started).toEqual(['run', 'b', 'run'])
      expect(db.getJob(run)?.status).toBe('running')
      expect(jobs.getLog(run)).not.toContain('Cancelled')
    })

    it('is not a failure or a cancel: nothing to retry, and the job stays active for its game', async () => {
      db.insertGame({ id: 'g', title: 'G' })
      const run = jobs.enqueue('test', 'g', { name: 'run' })
      await expect.poll(() => started).toEqual(['run'])
      await request(app).post(`/api/jobs/${run}/pause`).expect(200)
      await expect.poll(() => db.getJob(run)?.status).toBe('paused')
      expect(jobs.activeFor('g')?.id).toBe(run)
      await request(app).post(`/api/jobs/${run}/retry`).expect(409)
      // Clearing finished jobs leaves it.
      await request(app).delete('/api/jobs').expect(200)
      expect(db.getJob(run)?.status).toBe('paused')
      // A paused job can still be cancelled.
      await request(app).post(`/api/jobs/${run}/cancel`).expect(200)
      expect(db.getJob(run)?.status).toBe('cancelled')
    })

    it('stays paused through a restart, and a running job paused before it does not come back as interrupted', async () => {
      const run = named('run')
      await expect.poll(() => started).toEqual(['run'])
      const b = named('b')
      named('c')
      await request(app).post(`/api/jobs/${b}/pause`).expect(200)
      await request(app).post(`/api/jobs/${run}/pause`).expect(200)
      await expect.poll(() => db.getJob(run)?.status).toBe('paused')
      await expect.poll(() => started.at(-1)).toBe('c')
      jobs = boot()
      jobs.start()
      expect(db.getJob(run)?.status).toBe('paused')
      expect(db.getJob(b)?.status).toBe('paused')
      expect(await order()).toEqual(['run', 'b'])
    })

    it('answers 409 for a job in a state that cannot do it', async () => {
      const run = named('run')
      const b = named('b')
      await expect.poll(() => started).toEqual(['run'])
      await request(app).post(`/api/jobs/${b}/resume`).expect(409)
      gates.get('run')!()
      await expect.poll(() => db.getJob(run)?.status).toBe('done')
      await request(app).post(`/api/jobs/${run}/pause`).expect(409)
      await request(app).post(`/api/jobs/${run}/resume`).expect(409)
      await request(app).post('/api/jobs/nope/pause').expect(404)
    })
  })

  describe('titles', () => {
    it('names the game by its title, and says nothing when no game is known', async () => {
      db.insertGame({ id: 'g', title: 'Green Game' })
      const known = jobs.enqueue('test', 'g', { name: 'one', path: 'one' })
      await expect.poll(() => started).toEqual(['one'])
      // A first install of an archive the catalog knows, and one it does not.
      const matched = jobs.enqueue('test', '', { name: 'two', source: { kind: 'archive', path: 'Downloads/PaleCarnations-1.2-pc.zip' } })
      const unknown = jobs.enqueue('test', '', { name: 'three', source: { kind: 'archive', path: 'Downloads/mystery-1.0.zip' } })
      const byId = Object.fromEntries((await list()).map((j) => [j.id, j.title]))
      expect(byId).toEqual({ [known]: 'Green Game', [matched]: 'Pale Carnations', [unknown]: null })
    })
  })
})
