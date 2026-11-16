import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig, type Config, type DemoGuestLimits } from '../config.js'

const roots: string[] = [], apps: App[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const app of apps.splice(0)) app.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const site = { 'Sec-Fetch-Site': 'same-origin' }
const newKey = () => randomBytes(32).toString('base64url')
const SAVE = '/api/saves/safe/file?path=safe/1-1-LT1.save'

async function start(demo: boolean, limits: Partial<DemoGuestLimits> = {}, extra: Partial<Config> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'renplay-visitors-')); roots.push(root)
  vi.stubEnv('RENPLAY_DEMO', demo ? 'on' : 'off')
  vi.stubEnv('RENPLAY_DEMO_EMBEDDER', 'https://website.example')
  vi.stubEnv('DATA_DIR', join(root, 'data'))
  vi.stubEnv('GAMES_DIR', join(root, 'games'))
  const base = loadConfig()
  const cfg = { ...base, auth: 'on' as const, catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', adultGames: 'off' as const, trustedHops: 1, demoGuests: { ...base.demoGuests, ...limits }, ...extra }
  const app = await createApp(cfg, { startJobs: false }); apps.push(app)
  app.db.insertGame({ id: 'safe', title: 'Safe', recipe_id: 'safe', adult: 0, status: 'installed', build: 'b1', engine: '8.5.3', save_dir: 'safe' })
  return app
}

interface Visit { cookie: string; headers: string[] }
/** Opens the demo the way a frame does: with a visitor key, or as a plain visitor. */
async function enter(app: App, key?: string, address = '10.0.0.1', cookie = ''): Promise<Visit> {
  const req = request(app.app).post('/api/auth/demo').set(site).set('X-Forwarded-For', address)
  if (cookie) req.set('Cookie', cookie)
  const res = await req.send(key ? { visitor: key } : {}).expect(200)
  const headers = ([] as string[]).concat(res.headers['set-cookie'] ?? [])
  return { cookie: headers.map((c) => c.split(';')[0]!).find((c) => c.startsWith('renplay_session=')) ?? cookie, headers }
}
const me = async (app: App, cookie: string) => (await request(app.app).get('/api/me').set('Cookie', cookie).expect(200)).body
const userId = async (app: App, cookie: string) => (await me(app, cookie)).user.id as number
const save = (app: App, cookie: string, body = 'a save') => request(app.app).put(SAVE).set(site).set('Cookie', cookie).set('Content-Type', 'application/octet-stream').send(Buffer.from(body))
const saved = async (app: App, cookie: string) => (await request(app.app).get('/api/saves/safe').set('Cookie', cookie).expect(200)).body

describe('the demo gives each visitor their own guest', () => {
  it('keeps two visitors apart: saves, ratings and favourites are never shared', async () => {
    const app = await start(true)
    const anna = await enter(app, undefined, '10.0.0.1'), ben = await enter(app, undefined, '10.0.0.2')
    expect(await userId(app, anna.cookie)).not.toBe(await userId(app, ben.cookie))
    expect(await me(app, anna.cookie)).toMatchObject({ demo: true, user: { role: 'player' } })
    await save(app, anna.cookie).expect(200)
    await request(app.app).put('/api/games/safe/rating').set(site).set('Cookie', anna.cookie).send({ rating: 5 }).expect(200)
    await request(app.app).put('/api/games/safe/favorite').set(site).set('Cookie', anna.cookie).send({ on: true }).expect(200)
    const rated = async (cookie: string) => (await request(app.app).get('/api/games/safe').set('Cookie', cookie).expect(200)).body.game
    expect(await rated(anna.cookie)).toMatchObject({ rating: 5, favoriteAt: expect.any(String) })
    expect(await rated(ben.cookie)).toMatchObject({ rating: null, favoriteAt: null })
    const files = (body: { files?: unknown[]; saves?: unknown[] }) => JSON.stringify(body)
    expect(files(await saved(app, anna.cookie))).toContain('1-1-LT1.save')
    expect(files(await saved(app, ben.cookie))).not.toContain('1-1-LT1.save')
    // A plain visitor who comes back with their session is the same guest, not a new one.
    const again = await enter(app, undefined, '10.0.0.1', anna.cookie)
    expect(await userId(app, again.cookie)).toBe(await userId(app, anna.cookie))
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get()).toMatchObject({ n: 2 })
  })

  it('gives two frames with one visitor key one guest, and another key another guest', async () => {
    const app = await start(true)
    const key = newKey()
    const laptop = await enter(app, key), phone = await enter(app, key)
    expect(laptop.cookie).not.toBe(phone.cookie)
    expect(await userId(app, laptop.cookie)).toBe(await userId(app, phone.cookie))
    await save(app, laptop.cookie, 'made on the laptop').expect(200)
    expect(JSON.stringify(await saved(app, phone.cookie))).toContain('1-1-LT1.save')
    // The same key on a later visit, from another address and with no session, is still that guest.
    const later = await enter(app, key, '10.9.9.9')
    expect(await userId(app, later.cookie)).toBe(await userId(app, laptop.cookie))
    const other = await enter(app, newKey())
    expect(await userId(app, other.cookie)).not.toBe(await userId(app, laptop.cookie))
    expect(JSON.stringify(await saved(app, other.cookie))).not.toContain('1-1-LT1.save')
    // A frame that already has a session of another guest takes the key's guest.
    const mixed = await enter(app, key, '10.0.0.1', other.cookie)
    expect(await userId(app, mixed.cookie)).toBe(await userId(app, laptop.cookie))
    // Two frames loading at the very same moment still make one guest.
    const fresh = newKey()
    const both = await Promise.all([enter(app, fresh, '10.0.0.5'), enter(app, fresh, '10.0.0.5')])
    expect(await userId(app, both[0].cookie)).toBe(await userId(app, both[1].cookie))
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get()).toMatchObject({ n: 3 })
  })

  it('stores only a hash of the key, never logs it and refuses a key that is too short to be unguessable', async () => {
    const app = await start(true)
    const lines: string[] = []
    for (const stream of [process.stdout, process.stderr]) vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => { lines.push(String(chunk)); return true }) as never)
    vi.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args.join(' ')) })
    vi.spyOn(console, 'warn').mockImplementation((...args) => { lines.push(args.join(' ')) })
    const key = newKey()
    await enter(app, key)
    await request(app.app).post('/api/auth/demo').set(site).send({ visitor: 'short' }).expect(400)
    await request(app.app).post('/api/auth/demo').set(site).send({ visitor: `${key}!` }).expect(400)
    await request(app.app).post('/api/auth/demo').set(site).send({ visitor: { $ne: 1 } }).expect(400)
    expect(lines.join('\n')).not.toContain(key)
    const stored = JSON.stringify(app.db.raw.prepare('SELECT * FROM demo_guests').all()) + JSON.stringify(app.db.raw.prepare('SELECT * FROM sessions').all()) + JSON.stringify(app.db.raw.prepare('SELECT * FROM users').all())
    expect(stored).not.toContain(key)
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get()).toMatchObject({ n: 1 })
  })

  it('keeps the guest\'s rights: no installs, no admin, no account changes, whatever the key', async () => {
    const app = await start(true)
    const guest = await enter(app, newKey())
    const refused = [
      ['post', '/api/imports', {}], ['get', '/api/system', undefined], ['get', '/api/users', undefined], ['post', '/api/users', { username: 'x', password: 'another password' }],
      ['post', '/api/me/password', { current: 'x', password: 'another password' }], ['put', '/api/me/pin', { pin: '1234' }], ['post', '/api/me/tokens', { name: 'keep' }],
      ['delete', '/api/me/sessions', undefined], ['get', '/api/me/sessions', undefined], ['post', '/api/games/safe/art/upload?kind=grid', undefined],
      ['post', '/api/saves/safe/sync', { tz: 'UTC' }], ['post', '/api/saves/safe/import', undefined], ['post', '/api/saves/safe/copy', { from: 'safe', to: 'other' }],
      ['post', '/api/saves/safe/save-dir', { saveDir: 'x', screen: [19999, 19999] }],
      ['put', '/api/me', { name: 'Mine now' }],
    ] as const
    for (const [method, path, body] of refused) await (request(app.app) as any)[method](path).set(site).set('Cookie', guest.cookie).send(body).expect(403)
    await request(app.app).post('/api/auth/login').set(site).send({ username: 'admin', password: 'correct password' }).expect(403)
    expect((await me(app, guest.cookie)).user).toMatchObject({ role: 'player' })
    await save(app, guest.cookie, 'x'.repeat(2 << 20 | 1)).expect(413)
  })

  it('lets a guest choose their own tags and level for adult games without touching another guest', async () => {
    const app = await start(true)
    const anna = await enter(app, newKey()), ben = await enter(app, newKey())
    await request(app.app).put('/api/me/tags').set(site).set('Cookie', anna.cookie).send({ include: [], exclude: ['romance'] }).expect(200)
    expect((await request(app.app).get('/api/me/tags').set('Cookie', anna.cookie).expect(200)).body).toMatchObject({ exclude: ['romance'] })
    expect((await request(app.app).get('/api/me/tags').set('Cookie', ben.cookie).expect(200)).body.exclude ?? []).not.toContain('romance')
    await request(app.app).put('/api/me/adult').set(site).set('Cookie', anna.cookie).send({ level: 'off' }).expect(200)
    expect((await request(app.app).get('/api/me/adult').set('Cookie', anna.cookie).expect(200)).body).toMatchObject({ choice: 'off' })
    expect((await request(app.app).get('/api/me/adult').set('Cookie', ben.cookie).expect(200)).body).toMatchObject({ choice: 'blurred' })
    // Never above the guest's ceiling, which is Blurred.
    await request(app.app).put('/api/me/adult').set(site).set('Cookie', anna.cookie).send({ level: 'shown' }).expect(409)
  })
})

describe('the demo bounds its guests', () => {
  it('removes an idle guest with its saves and sessions, and keeps one that is seen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
    const app = await start(true, { idleMs: 3600_000 })
    const idle = await enter(app, newKey(), '10.0.0.1'), busy = await enter(app, newKey(), '10.0.0.2')
    await save(app, idle.cookie).expect(200); await save(app, busy.cookie).expect(200)
    const idleId = await userId(app, idle.cookie), busyId = await userId(app, busy.cookie)
    const folder = join(app.services.cfg.dataDir, 'users', String(idleId))
    expect(existsSync(folder)).toBe(true)
    vi.setSystemTime(new Date('2026-11-16T10:40:00Z'))
    await request(app.app).get('/api/games').set('Cookie', busy.cookie).expect(200)
    vi.setSystemTime(new Date('2026-11-16T11:10:00Z'))
    // The busy guest is seen again after the idle one's hour is up: its session touch records it.
    await request(app.app).get('/api/games').set('Cookie', busy.cookie).expect(200)
    expect(await app.accounts.sweepGuests()).toBe(1)
    await request(app.app).get('/api/me').set('Cookie', idle.cookie).expect(401)
    expect(await userId(app, busy.cookie)).toBe(busyId)
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(idleId)).toMatchObject({ n: 0 })
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(idleId)).toMatchObject({ n: 0 })
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM save_meta WHERE user_id = ?').get(idleId)).toMatchObject({ n: 0 })
    await vi.waitFor(() => expect(existsSync(folder)).toBe(false))
    expect(JSON.stringify(await saved(app, busy.cookie))).toContain('1-1-LT1.save')
    // The same key comes back as a new, empty guest.
    const back = await enter(app, undefined, '10.0.0.1')
    expect(JSON.stringify(await saved(app, back.cookie))).not.toContain('1-1-LT1.save')
    expect(await app.accounts.sweepGuests()).toBe(0)
  })

  it('counts a key sign-in as activity, so a guest who comes back just before the deadline is not swept', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
    const app = await start(true, { idleMs: 3600_000 })
    const key = newKey()
    const first = await enter(app, key)
    const id = await userId(app, first.cookie)
    await save(app, first.cookie).expect(200)
    // Just before the deadline the visitor comes back with the key and no cookie, which makes a new session.
    vi.setSystemTime(new Date('2026-11-16T10:59:00Z'))
    const back = await enter(app, key)
    // A frame that is already signed in as the key's guest is seen too.
    vi.setSystemTime(new Date('2026-11-16T11:00:30Z'))
    await enter(app, key, '10.0.0.1', back.cookie)
    // Past the original deadline, and past the idle time since the first sign-in. A plain guest that came back is seen too.
    const plain = await enter(app, undefined, '10.0.0.2')
    vi.setSystemTime(new Date('2026-11-16T11:00:40Z'))
    await enter(app, undefined, '10.0.0.2', plain.cookie)
    vi.setSystemTime(new Date('2026-11-16T11:30:00Z'))
    expect(await app.accounts.sweepGuests()).toBe(0)
    expect(await userId(app, back.cookie)).toBe(id)
    expect(JSON.stringify(await saved(app, back.cookie))).toContain('1-1-LT1.save')
    // And it is swept once it has really been idle.
    vi.setSystemTime(new Date('2026-11-16T12:45:00Z'))
    expect(await app.accounts.sweepGuests()).toBe(2)
  })

  it('does not sweep a guest that is seen between choosing it and removing it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
    const app = await start(true, { idleMs: 3600_000 })
    const first = await enter(app, newKey(), '10.0.0.1'), second = await enter(app, newKey(), '10.0.0.2')
    const ids = [await userId(app, first.cookie), await userId(app, second.cookie)]
    vi.setSystemTime(new Date('2026-11-16T11:30:00Z'))
    // Removing the first guest takes a moment, and the second one plays in that moment.
    const purge = app.services.purger.purge.bind(app.services.purger)
    vi.spyOn(app.services.purger, 'purge').mockImplementation(async (path) => {
      await request(app.app).get('/api/games').set('Cookie', second.cookie).expect(200)
      await purge(path)
    })
    expect(await app.accounts.sweepGuests()).toBe(1)
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM users WHERE id = ?').get(ids[1]!)).toMatchObject({ n: 1 })
  })

  it('evicts the guest unseen the longest when the demo is full', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
    const app = await start(true, { max: 3 })
    const keys = [newKey(), newKey(), newKey()], visits: Visit[] = []
    for (const [i, key] of keys.entries()) { visits.push(await enter(app, key, `10.0.0.${i + 1}`)); vi.setSystemTime(Date.now() + 60_000) }
    const ids = await Promise.all(visits.map((v) => userId(app, v.cookie)))
    // The first guest is seen again, so the second is now the one unseen the longest.
    vi.setSystemTime(Date.now() + 10 * 60_000)
    await request(app.app).get('/api/games').set('Cookie', visits[0]!.cookie).expect(200)
    const fourth = await enter(app, newKey(), '10.0.0.4')
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get()).toMatchObject({ n: 3 })
    await request(app.app).get('/api/me').set('Cookie', visits[1]!.cookie).expect(401)
    expect(await userId(app, visits[0]!.cookie)).toBe(ids[0])
    expect(await userId(app, visits[2]!.cookie)).toBe(ids[2])
    expect(await userId(app, fourth.cookie)).not.toBe(ids[1])
    // Never more than the cap, however many come.
    for (let i = 5; i < 12; i++) { vi.setSystemTime(Date.now() + 11 * 60_000); await enter(app, newKey(), `10.0.1.${i}`) }
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get()).toMatchObject({ n: 3 })
    expect(app.db.raw.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 'guest-%'").get()).toMatchObject({ n: 3 })
  })

  it('protects guests seen in the last ten minutes: a full demo refuses a new arrival instead of evicting them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
    const app = await start(true, { max: 3, newPerHour: 2 })
    const keys = [newKey(), newKey(), newKey()], visits: Visit[] = []
    for (const [i, key] of keys.entries()) { visits.push(await enter(app, key, `10.0.0.${i + 1}`)); vi.setSystemTime(Date.now() + 60_000) }
    const ids = await Promise.all(visits.map((v) => userId(app, v.cookie)))
    // Everyone was seen a few minutes ago: nobody goes, whoever asks and however they ask.
    const full = /The demo is full right now\. Try again in a few minutes\./
    const late = newKey()
    for (const body of [{ visitor: late }, {}]) {
      const refused = await request(app.app).post('/api/auth/demo').set(site).set('X-Forwarded-For', '10.0.1.1').send(body).expect(503)
      expect(refused.body.error).toMatch(full)
      expect(refused.headers['set-cookie']).toBeUndefined()
    }
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get()).toMatchObject({ n: 3 })
    for (const [i, v] of visits.entries()) expect(await userId(app, v.cookie)).toBe(ids[i])
    // A visitor that already has a guest is let in, and a refusal does not use up the address's allowance of new guests.
    await enter(app, keys[0], '10.0.1.1')
    // Ten minutes on, one guest is seen and two are not: the one unseen the longest goes, and only it.
    // (The first has just come back with its key, so the third is the one unseen the longest.)
    vi.setSystemTime(new Date('2026-11-16T10:14:00Z'))
    await request(app.app).get('/api/games').set('Cookie', visits[1]!.cookie).expect(200)
    const arrived = await enter(app, late, '10.0.1.1')
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get()).toMatchObject({ n: 3 })
    await request(app.app).get('/api/me').set('Cookie', visits[2]!.cookie).expect(401)
    expect(await userId(app, visits[0]!.cookie)).toBe(ids[0])
    expect(await userId(app, visits[1]!.cookie)).toBe(ids[1])
    expect(await userId(app, arrived.cookie)).not.toBe(ids[2])
    // The arrival just made is protected in its turn.
    await request(app.app).post('/api/auth/demo').set(site).set('X-Forwarded-For', '10.0.1.1').send({ visitor: newKey() }).expect(503)
  })

  it('limits how many guests one address makes an hour, and counts only new ones', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
    const app = await start(true, { newPerHour: 3 })
    const first = newKey()
    await enter(app, first, '10.0.0.1'); await enter(app, newKey(), '10.0.0.1'); await enter(app, newKey(), '10.0.0.1')
    const refused = await request(app.app).post('/api/auth/demo').set(site).set('X-Forwarded-For', '10.0.0.1').send({ visitor: newKey() }).expect(429)
    expect(refused.body.error).toMatch(/guests/i)
    await request(app.app).post('/api/auth/demo').set(site).set('X-Forwarded-For', '10.0.0.1').send({}).expect(429)
    // A guest that exists is not new: a frame reloading, or another frame, is let in.
    await enter(app, first, '10.0.0.1')
    // Another address has its own count.
    await enter(app, newKey(), '10.0.0.2')
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get()).toMatchObject({ n: 4 })
    vi.setSystemTime(new Date('2026-11-16T11:00:01Z'))
    await enter(app, newKey(), '10.0.0.1')
  })

  it('keeps a limited number of sessions for a guest', async () => {
    const app = await start(true, { sessions: 3 })
    const key = newKey(), visits: Visit[] = []
    for (let i = 0; i < 5; i++) visits.push(await enter(app, key))
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM sessions').get()).toMatchObject({ n: 3 })
    await request(app.app).get('/api/me').set('Cookie', visits[0]!.cookie).expect(401)
    await request(app.app).get('/api/me').set('Cookie', visits[4]!.cookie).expect(200)
  })

  it('lets frames with no cookie ask again and again, but not without end', async () => {
    const app = await start(true)
    const key = newKey()
    for (let i = 0; i < 120; i++) await enter(app, key)
    await request(app.app).post('/api/auth/demo').set(site).set('X-Forwarded-For', '10.0.0.1').send({ visitor: key }).expect(429)
    await enter(app, key, '10.0.0.2')
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get()).toMatchObject({ n: 1 })
  })

  it('keeps no record of a guest\'s browser: repeated sign-ins with no cookie add no device rows', async () => {
    const app = await start(true)
    const key = newKey()
    const first = await enter(app, key)
    let last = first
    for (let i = 0; i < 30; i++) last = await enter(app, key)
    await enter(app)
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM device_people').get()).toMatchObject({ n: 0 })
    expect(first.headers.some((c) => c.startsWith('renplay_device='))).toBe(false)
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(await userId(app, last.cookie))).toMatchObject({ n: 20 })
  })

  it('gives the session cookie a partitioned form only over https, for a frame with a key', async () => {
    const insecure = await start(true)
    const lax = (await enter(insecure, newKey())).headers.find((c) => c.startsWith('renplay_session='))!
    expect(lax).toMatch(/HttpOnly/i); expect(lax).toMatch(/SameSite=Lax/i); expect(lax).not.toMatch(/Partitioned/i)
    const secure = await start(true, {}, { publicUrl: 'https://demo.example' })
    const framed = (await enter(secure, newKey())).headers.find((c) => c.startsWith('renplay_session='))!
    expect(framed).toMatch(/Secure/i); expect(framed).toMatch(/Partitioned/i); expect(framed).toMatch(/SameSite=None/i); expect(framed).toMatch(/HttpOnly/i)
    const direct = (await enter(secure)).headers.find((c) => c.startsWith('renplay_session='))!
    expect(direct).toMatch(/SameSite=Lax/i); expect(direct).not.toMatch(/Partitioned/i)
  })
})

describe('outside a demo none of this exists', () => {
  it('has no guests, no route and no table, and a key opens nothing', async () => {
    const app = await start(false)
    const key = newKey()
    await request(app.app).post('/api/auth/demo').set(site).send({ visitor: key }).expect(404)
    await request(app.app).post('/api/auth/demo').set(site).send({}).expect(404)
    for (const credential of [{ Cookie: `renplay_session=${key}` }, { Authorization: `Bearer ${key}` }, { 'X-Renplay-Visitor': key }]) await request(app.app).get('/api/me').set(credential).expect(401)
    expect(app.db.raw.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'demo_guests'").get()).toMatchObject({ n: 0 })
    expect(app.db.raw.prepare("SELECT COUNT(*) n FROM users WHERE username LIKE 'guest-%' OR username = 'demo'").get()).toMatchObject({ n: 0 })
    expect(await app.accounts.sweepGuests()).toBe(0)
  })

  it('never lets a visitor key sign in as anyone but a guest, in a demo', async () => {
    const app = await start(true)
    const key = newKey()
    for (const credential of [{ Cookie: `renplay_session=${key}` }, { Authorization: `Bearer ${key}` }, { 'X-Renplay-Visitor': key }]) await request(app.app).get('/api/me').set(credential).expect(401)
    const guest = await enter(app, key)
    expect((await me(app, guest.cookie)).user.id).toBeGreaterThan(1)
    expect(app.db.raw.prepare('SELECT g.user_id id FROM demo_guests g JOIN users u ON u.id = g.user_id WHERE u.role != ?').all('player')).toEqual([])
  })
})
