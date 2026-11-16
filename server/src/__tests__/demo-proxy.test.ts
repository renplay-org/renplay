import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, request as forward, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig, type DemoGuestLimits } from '../config.js'

const roots: string[] = [], apps: App[] = [], servers: Server[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))))
  for (const app of apps.splice(0)) app.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * The demo as it runs on its host: the demo image's nginx in front of Renplay, with an edge in
 * front of that. The proxy here makes the headers that nginx makes (image/nginx.conf.template and
 * the demo's Dockerfile): the client address from CF-Connecting-IP, appended to X-Forwarded-For,
 * and the scheme nginx itself was reached with, which is http behind the host's TLS edge.
 */
async function behindProxy(env: Record<string, string>, limits: Partial<DemoGuestLimits> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'renplay-proxy-')); roots.push(root)
  vi.stubEnv('RENPLAY_DEMO', 'on')
  vi.stubEnv('DATA_DIR', join(root, 'data'))
  vi.stubEnv('GAMES_DIR', join(root, 'games'))
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
  const base = loadConfig()
  const cfg = { ...base, auth: 'on' as const, catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', adultGames: 'off' as const, trustedHops: 1, demoGuests: { ...base.demoGuests, ...limits } }
  const app = await createApp(cfg, { startJobs: false }); apps.push(app)
  const node = app.app.listen(0, '127.0.0.1'); servers.push(node)
  await new Promise((done) => node.once('listening', done))
  const proxy = createServer((req, res) => {
    const client = String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress)
    const headers = { ...req.headers, 'x-forwarded-for': [req.headers['x-forwarded-for'], client].filter(Boolean).join(', '), 'x-forwarded-proto': 'http' }
    const upstream = forward({ host: '127.0.0.1', port: (node.address() as AddressInfo).port, path: req.url, method: req.method, headers }, (answer) => { res.writeHead(answer.statusCode!, answer.headers); answer.pipe(res) })
    req.pipe(upstream)
  })
  proxy.listen(0, '127.0.0.1'); servers.push(proxy)
  await new Promise((done) => proxy.once('listening', done))
  const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
  /** A request as the TLS edge forwards it: the visitor's own headers, and the edge's claim of HTTPS. */
  const send = (headers: Record<string, string>, body: unknown = {}) => new Promise<Answer>((done, fail) => {
    const payload = JSON.stringify(body)
    const req = forward(`${url}/api/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'x-forwarded-proto': 'https', host: 'demo.example', ...headers } }, (res) => {
      res.resume(); res.on('end', () => done({ status: res.statusCode!, cookies: res.headers['set-cookie'] ?? [] }))
    })
    req.on('error', fail); req.end(payload)
  })
  return { app, send }
}

/** What a request got: Node's own client, since fetch will not send a Host of the visitor's choosing. */
interface Answer { status: number; cookies: string[] }
const key = () => randomBytes(32).toString('base64url')
const sessionCookie = (res: Answer) => res.cookies.find((c) => c.startsWith('renplay_session='))
const HTTPS = { RENPLAY_PUBLIC_URL: 'https://demo.example' }

describe('the demo behind its proxy, on the host\'s HTTPS edge', () => {
  it('learns that it is served over HTTPS from RENPLAY_PUBLIC_URL, which the demo image sets', async () => {
    const { send } = await behindProxy(HTTPS)
    const framed = await send({ 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.7' }, { visitor: key() })
    expect(framed.status).toBe(200)
    expect(sessionCookie(framed)).toMatch(/Secure/i)
    expect(sessionCookie(framed)).toMatch(/Partitioned/i)
    expect(sessionCookie(framed)).toMatch(/SameSite=None/i)
    expect(sessionCookie(framed)).toMatch(/HttpOnly/i)
    const direct = await send({ 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.8' })
    expect(sessionCookie(direct)).toMatch(/Secure/i)
    expect(sessionCookie(direct)).toMatch(/SameSite=Lax/i)
    expect(sessionCookie(direct)).not.toMatch(/Partitioned/i)
  })

  it('has no way to tell without it: nginx passes its own http scheme, so the cookie is not Secure', async () => {
    const { send } = await behindProxy({})
    const res = await send({ 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.7' }, { visitor: key() })
    expect(res.status).toBe(200)
    expect(sessionCookie(res)).not.toMatch(/Secure/i)
    expect(sessionCookie(res)).not.toMatch(/Partitioned/i)
  })

  it('checks the origin against the public address when the browser sends no Fetch Metadata', async () => {
    const { send } = await behindProxy(HTTPS)
    expect((await send({ origin: 'https://demo.example', 'cf-connecting-ip': '203.0.113.7' })).status).toBe(200)
    expect((await send({ origin: 'https://evil.example', 'cf-connecting-ip': '203.0.113.7' })).status).toBe(403)
    expect((await send({ 'sec-fetch-site': 'cross-site', origin: 'https://demo.example', 'cf-connecting-ip': '203.0.113.7' })).status).toBe(403)
    const unset = await behindProxy({ RENPLAY_PUBLIC_URL: '' })
    // Without the public address the proxy's own scheme is http, and the page's https origin is not recognised.
    expect((await unset.send({ origin: 'https://demo.example', 'cf-connecting-ip': '203.0.113.7' })).status).toBe(403)
  })

  it('still works over plain HTTP when a local run sets RENPLAY_PUBLIC_URL empty, or to its own address', async () => {
    for (const value of ['', 'http://localhost:8080']) {
      const { send } = await behindProxy({ RENPLAY_PUBLIC_URL: value })
      const res = await send({ origin: 'http://localhost:8080', host: 'localhost:8080', 'x-forwarded-proto': 'http', 'cf-connecting-ip': '127.0.0.1' }, { visitor: key() })
      expect(res.status, `RENPLAY_PUBLIC_URL=${value}`).toBe(200)
      expect(sessionCookie(res)).not.toMatch(/Secure/i)
      expect(sessionCookie(res)).toMatch(/SameSite=Lax/i)
    }
  })

  it('counts each visitor by the edge\'s address and ignores a forwarded address the visitor made up', async () => {
    const { send } = await behindProxy(HTTPS, { newPerHour: 2 })
    const ask = (client: string, forged?: string) => send({ 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': client, ...(forged ? { 'x-forwarded-for': forged } : {}) }, { visitor: key() })
    expect((await ask('203.0.113.7')).status).toBe(200)
    expect((await ask('203.0.113.7', '198.51.100.1')).status).toBe(200)
    expect((await ask('203.0.113.7', '198.51.100.2')).status).toBe(429)
    expect((await ask('203.0.113.9')).status).toBe(200)
  })
})
