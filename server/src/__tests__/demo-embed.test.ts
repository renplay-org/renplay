import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { demoEmbedderOrigin, embedMessage } from '../shared/demo-embed.js'

const roots: string[] = [], apps: App[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})
async function start(demo: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'renplay-embed-')); roots.push(root)
  vi.stubEnv('RENPLAY_DEMO', demo ? 'on' : 'off')
  vi.stubEnv('RENPLAY_DEMO_EMBEDDER', 'https://website.example')
  vi.stubEnv('DATA_DIR', join(root, 'data'))
  vi.stubEnv('GAMES_DIR', join(root, 'games'))
  const cfg = { ...loadConfig(), auth: 'off' as const, catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', adultGames: 'off' as const }
  const app = await createApp(cfg, { startJobs: false }); apps.push(app)
  app.app.get(['/', '/game/safe', '/play/safe'], (_req, res) => res.send('<html>Library</html>'))
  app.db.insertGame({ id: 'safe', title: 'Safe', recipe_id: 'safe', adult: 0, status: 'installed', build: 'b1', engine: '8.5.3' })
  vi.spyOn(app.engines, 'template').mockResolvedValue('<html><head></head><body></body></html>')
  const cookie = demo ? (await request(app.app).post('/api/auth/demo').set('Sec-Fetch-Site', 'same-origin').expect(200)).headers['set-cookie'][0].split(';')[0] : ''
  return { app, cookie }
}

describe('public demo embedding', () => {
  it.each([false, true])('changes framing only in a demo (%s)', async (demo) => {
    const { app, cookie } = await start(demo)
    for (const path of ['/', '/game/safe', '/play/safe', '/g/safe/b1/']) {
      const response = await request(app.app).get(`${path}?embed=phone`).set('Cookie', cookie).expect(200)
      expect(response.headers['content-security-policy']).toBe(demo ? "frame-ancestors 'self' https://website.example" : path.startsWith('/g/') ? "frame-ancestors 'self'" : undefined)
    }
    const me = (await request(app.app).get('/api/me').set('Cookie', cookie).expect(200)).body
    expect(me.demoEmbedder).toBe(demo ? 'https://website.example' : undefined)
    expect((await request(app.app).get('/api/health')).headers['content-security-policy']).toBeUndefined()
  })
  it('accepts one exact origin and refuses CSP injection, wildcards and URL paths', () => {
    expect(demoEmbedderOrigin('https://renplay.org')).toBe('https://renplay.org')
    expect(demoEmbedderOrigin('http://127.0.0.1:5190')).toBe('http://127.0.0.1:5190')
    for (const value of ['https://*.renplay.org', 'https://renplay.org/', 'https://renplay.org/path', 'https://user@renplay.org', 'https://renplay.org https://evil.test', "https://renplay.org; script-src *", 'data:text/html,test']) expect(() => demoEmbedderOrigin(value), value).toThrow()
  })
  it('ignores a wrong message origin, window or command', () => {
    const parent = {} as Window, other = {} as Window
    const event = { origin: 'https://renplay.org', source: parent, data: { type: 'renplay-embed:refresh' } }
    expect(embedMessage(event, event.origin, parent)).toBe('refresh')
    expect(embedMessage({ ...event, data: { type: 'renplay-embed:nudge' } }, event.origin, parent)).toBe('nudge')
    expect(embedMessage({ ...event, origin: 'https://evil.test' }, event.origin, parent)).toBeNull()
    expect(embedMessage({ ...event, source: other }, event.origin, parent)).toBeNull()
    expect(embedMessage({ ...event, data: { type: 'renplay:refresh' } }, event.origin, parent)).toBeNull()
  })
  it('defaults to the public website and stops a demo with an invalid embedder', () => {
    vi.stubEnv('RENPLAY_DEMO', 'on')
    vi.stubEnv('RENPLAY_DEMO_EMBEDDER', '')
    expect(loadConfig().demoEmbedder).toBe('https://renplay.org')
    vi.stubEnv('RENPLAY_DEMO_EMBEDDER', '*')
    expect(() => loadConfig()).toThrow()
  })
  it('ignores the embedder setting entirely on a real installation', () => {
    vi.stubEnv('RENPLAY_DEMO', 'off')
    vi.stubEnv('RENPLAY_DEMO_EMBEDDER', '*')
    expect(loadConfig().demoEmbedder).toBe('')
  })
})
