import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { archiveIdentity } from '../library/archives.js'
import { downloadsDirectory, loadConfig } from '../config.js'
import { Db } from '../db.js'
import type { JobContext } from '../jobs/manager.js'
import { deleteSource, type ImportDeps, type ImportParams } from '../pipeline/import.js'

describe('archives after install', () => {
  const roots: string[] = []
  afterEach(() => {
    delete process.env['RENPLAY_DELETE_ARCHIVES']
    delete process.env['RENPLAY_KEEP_DOWNLOADS']
    delete process.env['ARCHIVES_DIR']
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('keeps downloads by default and supports the deprecated inverse alias', () => {
    expect(loadConfig().keepDownloads).toBe(true)
    expect(loadConfig().keepDownloadsLocked).toBe(false)
    process.env['RENPLAY_DELETE_ARCHIVES'] = 'true'
    expect(loadConfig().keepDownloads).toBe(false)
    for (const v of ['false', '0', 'no', 'off', 'FALSE']) {
      process.env['RENPLAY_DELETE_ARCHIVES'] = v
      expect(loadConfig().keepDownloads).toBe(true)
      expect(loadConfig().keepDownloadsLocked).toBe(true)
    }
  })

  it('gives the new variable precedence and locks explicit choices', () => {
    process.env['RENPLAY_DELETE_ARCHIVES'] = 'true'
    process.env['RENPLAY_KEEP_DOWNLOADS'] = 'true'
    expect(loadConfig().keepDownloads).toBe(true)
    process.env['RENPLAY_KEEP_DOWNLOADS'] = 'false'
    expect(loadConfig().keepDownloads).toBe(false)
    expect(loadConfig().keepDownloadsLocked).toBe(true)
  })

  it('selects only an existing downloads directory and honors ARCHIVES_DIR', () => {
    const root = mkdtempSync(join(tmpdir(), 'renplay-paths-'))
    roots.push(root)
    expect(downloadsDirectory('/games', join(root, 'missing'))).toBe('/games/_archives')
    const file = join(root, 'file')
    writeFileSync(file, '')
    expect(downloadsDirectory('/games', file)).toBe('/games/_archives')
    expect(downloadsDirectory('/games', root)).toBe(root)
    chmodSync(root, 0o555)
    if (process.getuid?.() !== 0) expect(downloadsDirectory('/games', root)).toBe('/games/_archives')
    chmodSync(root, 0o755)
    process.env['ARCHIVES_DIR'] = root
    expect(loadConfig().archivesDir).toBe(root)
    expect(loadConfig().workDir).toBe('/games/_renplay/work')
  })

  for (const scenario of ['uploaded', 'copied', 'replaced', 'edited', 'disabled', 'rescanned', 'restarted', 'settings-off', 'settings-on'] as const) {
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
      if (scenario.startsWith('settings-')) {
        db.setSetting('keep_downloads', scenario === 'settings-on')
        db.close()
        db = new Db(join(dir, 'library.db'))
      }
      const deps = { cfg: { archivesDir: dir, keepDownloads: scenario === 'disabled', keepDownloadsLocked: !scenario.startsWith('settings-') }, db } as ImportDeps
      try {
        await deleteSource(ctx, deps)
        const removed = ['uploaded', 'rescanned', 'restarted', 'settings-off'].includes(scenario)
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
