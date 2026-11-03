import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import type { Db } from '../db.js'
import type { JobContext } from '../jobs.js'
import { deleteSource, type ImportDeps, type ImportParams } from '../pipeline/import.js'

describe('archives after install', () => {
  afterEach(() => {
    delete process.env['RENPLAY_DELETE_ARCHIVES']
  })

  it('are deleted unless RENPLAY_DELETE_ARCHIVES is off', () => {
    expect(loadConfig().deleteArchives).toBe(true)
    for (const v of ['false', '0', 'no', 'off', 'FALSE']) {
      process.env['RENPLAY_DELETE_ARCHIVES'] = v
      expect(loadConfig().deleteArchives).toBe(false)
    }
    process.env['RENPLAY_DELETE_ARCHIVES'] = 'true'
    expect(loadConfig().deleteArchives).toBe(true)
  })

  it('removes the source archive and its record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'renplay-archives-'))
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'Game-1.0-pc.zip'), 'zip')
    const logs: string[] = []
    const forgotten: string[] = []
    const ctx = { params: { source: { kind: 'archive', path: 'sub/Game-1.0-pc.zip' } }, log: (l: string) => logs.push(l) } as unknown as JobContext<ImportParams>
    const deps = { cfg: { archivesDir: dir }, db: { deleteArchive: (p: string) => forgotten.push(p) } as unknown as Db } as ImportDeps
    await deleteSource(ctx, deps)
    expect(existsSync(join(dir, 'sub', 'Game-1.0-pc.zip'))).toBe(false)
    expect(forgotten).toEqual(['sub/Game-1.0-pc.zip'])
    expect(logs[0]).toMatch(/^Deleted sub\/Game-1\.0-pc\.zip/)
    // A missing archive is reported, not fatal: the game is installed either way.
    await deleteSource(ctx, deps)
    expect(logs[1]).toMatch(/^Could not delete/)
  })
})
