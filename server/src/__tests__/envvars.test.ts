import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENV_VARS } from '../envvars.js'
import { loadConfig } from '../config.js'
// @ts-expect-error plain script without types
import { pagePath, render } from '../../../docs/site/scripts/gen-config.mjs'

describe('environment variables', () => {
  it('lists every variable config.ts and the container user switch read, once', () => {
    const source = readFileSync(new URL('../config.ts', import.meta.url), 'utf8')
    const read = [...source.matchAll(/\b(?:env(?:Int|Bool)?|secret)\('([A-Z_]+)'/g), ...source.matchAll(/process\.env\['([A-Z_]+)'\]/g)].map(
      (m) => m[1],
    )
    const entrypoint = readFileSync(new URL('../../../deploy/entrypoint.sh', import.meta.url), 'utf8')
    read.push(...[...entrypoint.matchAll(/\$\{(PUID|PGID):-/g)].map((m) => m[1]))
    const listed = ENV_VARS.map((v) => v.name)
    expect([...new Set([...read, ...[...source.matchAll(/secret\('([A-Z_]+)'/g)].map((m) => `${m[1]}_FILE`)])].sort()).toEqual([...listed].sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('keeps the defaults it documents', () => {
    const saved = { ...process.env }
    for (const v of ENV_VARS) delete process.env[v.name]
    try {
      const cfg = loadConfig()
      expect(cfg.port).toBe(3000)
      expect(cfg.gamesDir).toBe('/games')
      expect(cfg.archivesDir).toBe('/games/_archives')
      expect(cfg.savesDir).toBe('/data/saves')
      expect(cfg.keepDownloads).toBe(true)
      expect(cfg.keepDownloadsLocked).toBe(false)
      expect(cfg.imageQuality).toBe(88)
      expect(cfg.saveHistoryVersions).toBe(20)
      expect(cfg.catalogUrls).toEqual(['https://catalog.renplay.org/index.v3.json'])
    } finally {
      process.env = saved
    }
  })

  it('has a configuration page in the docs that is up to date', () => {
    // When this fails: cd docs/site && npm run gen
    expect(readFileSync(pagePath, 'utf8')).toBe(render())
  })
})
