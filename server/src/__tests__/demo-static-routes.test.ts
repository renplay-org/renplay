import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { DEMO_ROUTES } from './demo-static-routes.js'

describe('the static demo and the server routes', () => {
  it('lists exactly the routes the server registers, each once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'renplay-demo-routes-'))
    vi.stubEnv('RENPLAY_DEMO', 'on')
    vi.stubEnv('DATA_DIR', join(root, 'data'))
    vi.stubEnv('GAMES_DIR', join(root, 'games'))
    const app = await createApp({ ...loadConfig(), catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', adultGames: 'off' }, { startJobs: false })
    try {
      const list = (stack: any[]): string[] => (stack ?? []).flatMap((layer: any) => layer.route ? Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${String(layer.route.path)}`) : layer.handle?.stack ? list(layer.handle.stack) : [])
      const classified = Object.values(DEMO_ROUTES).flat()
      expect(new Set(classified).size).toBe(classified.length)
      expect(list((app.app as any).router.stack).sort()).toEqual(classified.sort())
    } finally {
      app.close()
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
