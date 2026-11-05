import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { archiveIdentity } from '../archive-origin.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'
import type { JobContext } from '../jobs.js'
import { deleteSource, type ImportDeps, type ImportParams } from '../pipeline/import.js'

describe('archives after install', () => {
  const roots: string[] = []
  afterEach(() => {
    delete process.env['RENPLAY_DELETE_ARCHIVES']
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('enables upload cleanup unless RENPLAY_DELETE_ARCHIVES is off', () => {
    expect(loadConfig().deleteArchives).toBe(true)
    for (const v of ['false', '0', 'no', 'off', 'FALSE']) {
      process.env['RENPLAY_DELETE_ARCHIVES'] = v
      expect(loadConfig().deleteArchives).toBe(false)
    }
  })

  for (const scenario of ['uploaded', 'copied', 'replaced', 'edited', 'disabled', 'rescanned', 'restarted'] as const) {
    it(`handles ${scenario} archives without deleting someone else's download`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'renplay-archives-'))
      roots.push(dir)
      mkdirSync(join(dir, 'sub'))
      const rel = 'sub/Game-1.0-pc.zip', path = join(dir, rel)
      writeFileSync(path, 'zip')
      let db = new Db(join(dir, 'library.db'))
      if (scenario !== 'copied') db.markUploadedArchive(rel, archiveIdentity(statSync(path)))
      db.upsertArchive({ path: rel, size: 3, mtime_ms: Math.floor(statSync(path).mtimeMs) })
      if (scenario === 'replaced') { rmSync(path); writeFileSync(path, 'replacement') }
      if (scenario === 'edited') writeFileSync(path, 'edited download')
      if (scenario === 'restarted') { db.close(); db = new Db(join(dir, 'library.db')) }
      const logs: string[] = []
      const ctx = { params: { source: { kind: 'archive', path: rel } }, log: (l: string) => logs.push(l) } as unknown as JobContext<ImportParams>
      const deps = { cfg: { archivesDir: dir, deleteArchives: scenario !== 'disabled' }, db } as ImportDeps
      try {
        await deleteSource(ctx, deps)
        const removed = ['uploaded', 'rescanned', 'restarted'].includes(scenario)
        expect(existsSync(path)).toBe(!removed)
        expect(db.getArchive(rel) === null).toBe(removed)
        if (removed) {
          expect(logs[0]).toMatch(/^Deleted sub\/Game-1\.0-pc\.zip/)
          await deleteSource(ctx, deps)
          expect(logs[1]).toMatch(/^Could not delete/)
        }
      } finally { db.close() }
    })
  }
})
