import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENV_VARS } from '../envvars.js'
import { loadConfig } from '../config.js'
// @ts-expect-error plain script without types
import { pagePath, render } from '../../../docs/site/scripts/gen-config.mjs'

describe('environment variables', () => {
  it('lists every variable the server and the container read, once', () => {
    const saved = process.env
    const read = new Set<string>()
    process.env = new Proxy({} as NodeJS.ProcessEnv, {
      get: (env, name) => {
        if (typeof name === 'string') read.add(name)
        return env[name as string]
      },
    })
    try {
      loadConfig()
    } finally {
      process.env = saved
    }
    // The container's own script reads these before the server starts.
    const entrypoint = readFileSync(new URL('../../../image/entrypoint.sh', import.meta.url), 'utf8')
    for (const m of entrypoint.matchAll(/\$\{(PUID|PGID|RENPLAY_LOG_LEVEL):-/g)) read.add(m[1]!)
    const listed = ENV_VARS.map((v) => v.name)
    expect([...read].sort()).toEqual([...listed].sort())
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
      expect(cfg.keepDownloads).toBe(true)
      expect(cfg.keepDownloadsLocked).toBe(false)
      expect(cfg.imageQuality).toBe(88)
      expect(cfg.saveHistoryVersions).toBe(20)
      expect(cfg.catalogUrls).toEqual(['https://catalog.renplay.org/index.v4.json'])
    } finally {
      process.env = saved
    }
  })

  it('has a configuration page in the docs that is up to date', () => {
    // When this fails: cd docs/site && npm run gen
    expect(readFileSync(pagePath, 'utf8')).toBe(render())
  })
})
