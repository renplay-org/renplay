import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'
import { JOB_LOG_LIMIT, JobLogs } from '../joblogs.js'
import { JobManager } from '../jobs.js'
import { createSystemRouter } from '../routes/system.js'

describe('job logs', () => {
  it('caps and rotates logs by bytes, including a single huge line, and removes orphan files', () => {
    const root = mkdtempSync(join(tmpdir(), 'renplay-joblogs-'))
    try {
      const logs = new JobLogs(root)
      for (let i = 0; i < 40; i++) logs.append('job', `line ${i} ${'ą'.repeat(4000)}\n`)
      expect(logs.read('job')).toContain('line 39')
      expect(logs.read('job')).not.toContain('line 0 ')
      logs.append('huge', `${'x'.repeat(JOB_LOG_LIMIT * 3)}last line\n`)
      expect(logs.read('huge')!.endsWith('last line\n')).toBe(true)
      const files = readdirSync(join(root, 'job-logs'))
      expect(files.filter((f) => f.startsWith('job.'))).toHaveLength(2)
      for (const file of files) expect(statSync(join(root, 'job-logs', file)).size).toBeLessThanOrEqual(JOB_LOG_LIMIT)
      expect(Buffer.byteLength(logs.read('job')!)).toBeLessThanOrEqual(JOB_LOG_LIMIT + 3)
      logs.clean((id) => id === 'job')
      expect(readdirSync(join(root, 'job-logs'))).toEqual(['job.log', 'job.log.1'])
      expect(() => logs.read('../bad')).toThrow('Invalid job id')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('serves a running job log after a manager restart, before any final database log write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'renplay-jobs-'))
    const db = Db.open(root)
    const cfg = { ...loadConfig(), dataDir: root, keepaliveUrl: '' }
    let finish!: () => void
    const gate = new Promise<void>((resolve) => { finish = resolve })
    const original = new JobManager(db, cfg)
    try {
      original.register('test', async (ctx) => {
        ctx.log('Source: game with spaces.zip')
        ctx.log('Unpacking: 74%')
        await gate
      })
      const id = original.enqueue('test', '', {})
      expect(db.getJob(id)?.log).toBe('')
      expect(db.getJob(id)?.status).toBe('running')
      const restarted = new JobManager(db, cfg)
      restarted.start()
      expect(db.getJob(id)?.status).toBe('interrupted')
      const app = express()
      app.use('/api', createSystemRouter(cfg, db, restarted, null as never, null as never, null as never, 'test', { hides: () => false } as never))
      const response = await request(app).get(`/api/jobs/${id}/log`).expect(200)
      expect(response.text).toContain('Source: game with spaces.zip')
      expect(response.text).toContain('Unpacking: 74%')
      finish()
      await expect.poll(() => original.isBusy()).toBe(false)
      // Old jobs still read their database log; clearing the UI removes files too.
      db.insertJob({ id: 'legacy', type: 'test', game: '', params: '{}' })
      db.updateJob('legacy', { status: 'done', log: 'Legacy log' })
      expect(restarted.getLog('legacy')).toBe('Legacy log')
      await request(app).delete('/api/jobs').expect(200)
      expect(db.getJob(id)).toBeNull()
      expect(readdirSync(join(root, 'job-logs'))).toEqual([])
    } finally {
      finish()
      await expect.poll(() => original.isBusy()).toBe(false)
      // pump() schedules a final queue check with setImmediate.
      await new Promise((resolve) => setImmediate(resolve))
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
