import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, scryptSync } from 'node:crypto'
import request from 'supertest'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig, type Config } from '../config.js'
import { Db, type GameRow } from '../db.js'
import { playerRoute } from '../accounts/access.js'
import { keepaliveToken } from '../jobs/keepalive.js'
import { viewer, viewers } from '../accounts/context.js'
import yazl from 'yazl'
import { renpyRuntime, sharedMirror } from './runtime-browser.js'

function zipBuffer(entries: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve) => {
    const zip = new yazl.ZipFile(), chunks: Buffer[] = []
    for (const [key, value] of Object.entries(entries)) zip.addBuffer(Buffer.from(value), key)
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zip.end()
  })
}

const roots: string[] = [], apps: App[] = []
afterEach(() => { for (const a of apps.splice(0)) a.close(); for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); vi.restoreAllMocks() })
function config(): Config {
  const root = mkdtempSync(join(tmpdir(), 'renplay-auth-')); roots.push(root)
  const cfg = loadConfig()
  const dataDir = join(root, 'data'), gamesDir = join(root, 'games'), internalDir = join(gamesDir, '_renplay')
  return { ...cfg, dataDir, gamesDir, internalDir, walkthroughsDir: join(dataDir, 'walkthroughs'), overlaysDir: join(dataDir, 'overlays'), workDir: join(internalDir, 'work'), purgeDir: join(internalDir, 'purge'), archivesDir: join(gamesDir, '_archives'), uploadsDir: join(internalDir, 'uploads'), enginesDir: join(internalDir, 'engines'), catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', auth: 'on', authLocal: true, authUser: 1, adultGames: 'shown', adminUsername: '', adminPassword: '', adultDefault: 'off' }
}
async function start(cfg = config(), seeded = true) {
  if (seeded) { cfg.adminUsername = 'admin'; cfg.adminPassword = 'correct password' }
  const a = await createApp(cfg, { startJobs: false }); apps.push(a)
  return a
}
const site = { 'Sec-Fetch-Site': 'same-origin' }
async function login(a: App, username = 'admin', password = 'correct password') {
  const response = await request(a.app).post('/api/auth/login').set(site).send({ username, password }).expect(200)
  return response.headers['set-cookie'][0].split(';')[0] as string
}
async function add(a: App, cookie: string, username = 'player') {
  return (await request(a.app).post('/api/users').set(site).set('Cookie', cookie).send({ username, password: 'player password' }).expect(201)).body.user.id as number
}
/** A library game, with a walkthrough file when one is named. */
function game(a: App, id = 'safe', { walkthroughFile, ...extras }: Partial<GameRow> & { walkthroughFile?: string } = {}) {
  a.db.insertGame({ id, title: id, recipe_id: `recipe-${id}`, status: 'installed', build: 'b1', save_dir: id, ...extras })
  if (walkthroughFile) a.db.raw.prepare("INSERT INTO walkthroughs (file, game, title, kind, added_at) VALUES (?, ?, 'Walkthrough', 'pdf', '2026-01-01')").run(walkthroughFile, id)
}

describe('accounts authentication and security', () => {
  it('restricts download retention and explicit deletion to admins without touching installed games or saves', async () => {
    const cfg = config(), a = await start(cfg), admin = await login(a)
    await add(a, admin)
    const player = await login(a, 'player', 'player password')
    const path = join(cfg.archivesDir, 'download.zip')
    mkdirSync(cfg.archivesDir, { recursive: true })
    writeFileSync(path, 'download')
    game(a, 'download-game', { source: JSON.stringify({ archive: 'download.zip' }) })
    mkdirSync(join(cfg.gamesDir, 'download-game/b1'), { recursive: true })
    writeFileSync(join(cfg.gamesDir, 'download-game/b1/game.zip'), 'installed')
    await a.services.saveStores.of(1).write('download-game', '1.save', Buffer.from('sacred'))
    expect((await request(a.app).get('/api/games/download-game').set('Cookie', admin)).body.game.canReinstall).toBe(true)
    await request(a.app).put('/api/system/downloads').set(site).set('Cookie', player).send({ keepDownloads: false }).expect(403)
    await request(a.app).delete('/api/games/download-game/download').set(site).set('Cookie', player).expect(403)
    await request(a.app).put('/api/system/downloads').set(site).set('Cookie', admin).send({ keepDownloads: 'false' }).expect(400)
    await request(a.app).put('/api/system/downloads').set(site).set('Cookie', admin).send({ keepDownloads: false }).expect(200)
    expect(a.db.getSetting('keep_downloads', true)).toBe(false)
    expect((await request(a.app).get('/api/system').set('Cookie', admin)).body.keepDownloads).toBe(false)
    cfg.keepDownloadsLocked = true
    cfg.keepDownloads = true
    await request(a.app).put('/api/system/downloads').set(site).set('Cookie', admin).send({ keepDownloads: false }).expect(409)
    expect((await request(a.app).get('/api/system').set('Cookie', admin)).body.keepDownloads).toBe(true)
    const active = vi.spyOn(a.jobs, 'activeFor').mockReturnValue({} as never)
    await request(a.app).delete('/api/games/download-game/download').set(site).set('Cookie', admin).expect(409)
    active.mockRestore()
    await request(a.app).delete('/api/games/download-game/download').set(site).set('Cookie', admin).expect(200)
    const g = (await request(a.app).get('/api/games/download-game').set('Cookie', admin)).body.game
    expect(g.canReinstall).toBe(false)
    expect(g.status).toBe('installed')
    expect(readFileSync(join(cfg.dataDir, 'users/1/saves/download-game/1.save'), 'utf8')).toBe('sacred')
    await request(a.app).delete('/api/games/download-game/download').set(site).set('Cookie', admin).expect(404)
  })
  it('supplies Account password state and Users save counts and protected accounts', async () => {
    const a = await start(), admin = await login(a), id = await add(a, admin)
    expect((await request(a.app).get('/api/me').set('Cookie', admin).expect(200)).body.hasPassword).toBe(true)
    await a.services.saveStores.of(id).write('one-game', '1-1.save', Buffer.from('save'))
    await a.services.saveStores.of(id).write('one-game', 'persistent', Buffer.from('persistent'))
    await a.services.saveStores.of(id).write('tokens', 'security_keys.txt', Buffer.from('keys'))
    const response = await request(a.app).get('/api/users').set('Cookie', admin).expect(200)
    expect(response.body.adultDefault).toBe('off')
    expect(response.body.users.find((u: { id: number }) => u.id === id)).toMatchObject({ games: 1, saves: 2, protected: false })
    expect(response.body.users.find((u: { id: number }) => u.id === 1)).toMatchObject({ games: 0, saves: 0, protected: true })
    const player = await login(a, 'player', 'player password')
    await request(a.app).get('/api/users').set('Cookie', player).expect(403)
    const cfg = config(); cfg.auth = 'off'; cfg.adultDefault = 'shown'
    const off = await start(cfg, false)
    expect((await request(off.app).get('/api/me').expect(200)).body.hasPassword).toBe(false)
    expect((await request(off.app).get('/api/users').expect(200)).body.adultDefault).toBe('shown')
  })
  it('rejects noncanonical routing before authentication, roles or CSRF can disagree', async () => {
    const a = await start(), admin = await login(a)
    await add(a, admin)
    const player = await login(a, 'player', 'player password')
    for (const path of ['/API/me/tokens', '/api/ME/tokens', '/api//me/tokens', '/api%2fme/tokens', '/api/me%2ftokens', '/api/me%5ctokens', '/api/me/tokens/', '/api/me%252ftokens']) {
      for (const cookie of ['', admin, player]) {
        const response = await request(a.app).post(path).set('Cookie', cookie).send({ name: 'Must not be minted' })
        expect(response.status, `${path}: ${cookie}`).toBeGreaterThanOrEqual(400)
      }
    }
    expect(a.db.raw.prepare('SELECT COUNT(*) n FROM tokens').get()!.n).toBe(0)
    for (const path of ['/api/auth/check/', '/API/auth/check', '/api/auth//check', '/api/auth%2fcheck', '/api/auth/check%2f', '/api/auth/check%3fpublic', '/api/auth/check%23public']) {
      await request(a.app).get(path).set('X-Original-URI', '/g/safe/b1/game.zip').expect(400)
    }
    await request(a.app).post('/api/me/tokens').set('Cookie', admin).send({ name: 'CSRF' }).expect(403)
    expect(() => a.accounts.current()).toThrow('Sign in')
  })
  it('denies ambiguous and unrecognized static resource paths instead of defaulting to permission', async () => {
    const a = await start(), admin = await login(a); await add(a, admin)
    const player = await login(a, 'player', 'player password')
    game(a, 'adult', { adult: 1 })
    for (const path of ['/g//adult/b1/assets.pack', '/api/covers//adult.webp', '/api/walkthroughs//adult.pdf', '/g/', '/api/covers/', '/g/adult/']) {
      await request(a.app).get('/api/auth/check').set('Cookie', player).set('X-Original-URI', path).expect(403)
    }
  })
  it('applies save import entry, link and file-size limits at the real personal and account endpoints', async () => {
    const a = await start(), cookie = await login(a); game(a)
    const bomb = await zipBuffer(Object.fromEntries(Array.from({ length: 2049 }, (_, i) => [`safe/${i}`, ''])))
    for (const [url, field] of [['/api/saves/safe/import', 'files'], ['/api/users/1/saves/import', 'file']]) {
      await request(a.app).post(url!).set(site).set('Cookie', cookie).attach(field!, bomb, 'saves.zip').expect(413)
      const symlink = await zipBuffer({ 'safe/persistent': 'outside' })
      const central = symlink.indexOf(Buffer.from('PK\x01\x02'))
      symlink.writeUInt32LE((0o120777 << 16) >>> 0, central + 38)
      await request(a.app).post(url!).set(site).set('Cookie', cookie).attach(field!, symlink, 'saves.zip').expect(400)
      const traversal = Buffer.from((await zipBuffer({ 'safe/slot': 'bad' })).toString('latin1').replaceAll('safe/slot', '../escape'), 'latin1')
      await request(a.app).post(url!).set(site).set('Cookie', cookie).attach(field!, traversal, 'saves.zip').expect(400)
    }
    await request(a.app).post('/api/saves/safe/import').set(site).set('Cookie', cookie).attach('files', Buffer.alloc((64 << 20) + 1), 'persistent').expect(400)
    expect(await a.saves.list('safe')).toEqual([])
  })
  it('upgrades legacy scrypt hashes after a successful sign-in and stores explicit work factors', async () => {
    const a = await start(), salt = 'legacy-salt'
    const legacy = `${salt}:${scryptSync('correct password', salt, 64).toString('hex')}`
    a.db.raw.prepare('UPDATE identities SET password = ?').run(legacy)
    await request(a.app).post('/api/auth/login').set(site).send({ username: 'admin', password: 'incorrect' }).expect(401)
    expect(a.db.raw.prepare('SELECT password FROM identities').get()!.password).toBe(legacy)
    await login(a)
    expect(a.db.raw.prepare('SELECT password FROM identities').get()!.password).toMatch(/^scrypt\$1\$131072\$8\$1\$/)
    await login(a)
  })
  it('defaults new folders to on, seeds the owner, hashes sessions and passwords, and supports plain HTTP and HTTPS cookies', async () => {
    const cfg = config(); cfg.auth = ''
    const a = await start(cfg)
    expect(a.accounts.enabled).toBe(true)
    await request(a.app).get('/api/games').expect(401)
    const response = await request(a.app).post('/api/auth/login').set(site).send({ username: 'ADMIN', password: 'correct password' }).expect(200)
    const cookie = response.headers['set-cookie'][0]
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Lax'); expect(cookie).not.toContain('Secure')
    const stored = a.db.raw.prepare('SELECT * FROM sessions').get()!
    expect(stored.hash).not.toBe(cookie.match(/renplay_session=([^;]+)/)![1])
    expect(a.db.raw.prepare('SELECT password FROM identities').get()!.password).not.toContain('correct password')
    const secure = await request(a.app).post('/api/auth/login').set(site).set('X-Forwarded-Proto', 'https').send({ username: 'admin', password: 'correct password' }).expect(200)
    expect(secure.headers['set-cookie'][0]).toContain('Secure')
    await request(a.app).get('/api/health').expect(200)
    await request(a.app).get('/api/keepalive').expect(401)
    await request(a.app).get('/api/keepalive').set('Authorization', `Bearer ${keepaliveToken}`).expect(200)
  })
  it('reads secret files, rejects ambiguous secrets and refuses sign-in with no enabled provider', async () => {
    const cfg = config(), path = join(cfg.dataDir, '..', 'password')
    writeFileSync(path, 'file password\n')
    const oldPassword = process.env.RENPLAY_ADMIN_PASSWORD, oldFile = process.env.RENPLAY_ADMIN_PASSWORD_FILE
    try {
      delete process.env.RENPLAY_ADMIN_PASSWORD; process.env.RENPLAY_ADMIN_PASSWORD_FILE = path
      expect(loadConfig().adminPassword).toBe('file password')
      process.env.RENPLAY_ADMIN_PASSWORD = 'ambiguous'
      expect(() => loadConfig()).toThrow('Set only')
    } finally {
      if (oldPassword === undefined) delete process.env.RENPLAY_ADMIN_PASSWORD; else process.env.RENPLAY_ADMIN_PASSWORD = oldPassword
      if (oldFile === undefined) delete process.env.RENPLAY_ADMIN_PASSWORD_FILE; else process.env.RENPLAY_ADMIN_PASSWORD_FILE = oldFile
    }
    cfg.authLocal = false
    await expect(start(cfg)).rejects.toThrow('No sign-in provider')
  })
  it('uses a per-boot setup code and a bounded attempt budget, and claims the owner without moving saves', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const a = await start(config(), false)
    const code = String(logs.mock.calls.find((c) => String(c[0]).includes('Setup code: '))![0]).split('Setup code: ')[1]!
    expect((await request(a.app).get('/api/auth/providers')).body.setup).toBe(true)
    await a.saves.write('safe', 'persistent', Buffer.from('before'))
    await request(a.app).post('/api/auth/setup').set(site).send({ username: 'owner', password: 'owner password' }).expect(403)
    const { grant } = (await request(a.app).post('/api/auth/setup/verify').set(site).send({ code }).expect(200)).body
    await request(a.app).post('/api/auth/setup').set(site).send({ grant, username: 'owner', name: 'Owner', password: 'owner password' }).expect(200)
    expect((await a.saves.read('safe', 'persistent')).toString()).toBe('before')
    await request(a.app).post('/api/auth/setup').set(site).send({ grant, username: 'other', password: 'other password' }).expect(403)
    const b = await start(config(), false)
    for (let i = 0; i < 10; i++) await request(b.app).post('/api/auth/setup/verify').set(site).send({ code: 'wrong' }).expect(403)
    await request(b.app).post('/api/auth/setup/verify').set(site).send({ code }).expect(429)
  })
  it('checks CSRF without constraining JSON, binary, multipart, chunked and empty bodies; bearer tokens bypass CSRF', async () => {
    const a = await start(), cookie = await login(a); game(a)
    const url = '/api/saves/safe/file?path=safe/persistent'
    await request(a.app).put(url).set('Cookie', cookie).set('Content-Type', 'application/octet-stream').send(Buffer.from('x')).expect(403)
    await request(a.app).put(url).set(site).set('Cookie', cookie).set('Content-Type', 'application/octet-stream').send(Buffer.from('x')).expect(200)
    await request(a.app).post('/api/saves/safe/import').set(site).set('Cookie', cookie).attach('files', Buffer.from('p'), 'persistent').expect(200)
    await request(a.app).delete(url).set(site).set('Cookie', cookie).expect(200)
    await request(a.app).put('/api/games/safe/favorite').set('Origin', 'http://renplay.test').set('Host', 'renplay.test').set('Cookie', cookie).send({ on: true }).expect(200)
    await request(a.app).put('/api/games/safe/favorite').set('Sec-Fetch-Site', 'cross-site').set('Origin', 'https://evil.test').set('Cookie', cookie).send({ on: true }).expect(403)
    const upload = (await request(a.app).post('/api/uploads').set(site).set('Cookie', cookie).send({ name: 'a.zip', size: 3 }).expect(200)).body.id
    await request(a.app).put(`/api/uploads/${upload}?offset=0`).set(site).set('Cookie', cookie).set('Content-Type', 'application/octet-stream').send(Buffer.from('zip')).expect(200)
    const { token, id } = (await request(a.app).post('/api/me/tokens').set(site).set('Cookie', cookie).send({ name: 'Script' }).expect(200)).body
    expect(a.db.raw.prepare('SELECT hash FROM tokens WHERE id = ?').get(id)!.hash).not.toBe(token)
    await request(a.app).put(url).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(Buffer.from('token')).expect(200)
    await request(a.app).delete(`/api/me/tokens/${id}`).set(site).set('Cookie', cookie).expect(200)
    await request(a.app).get('/api/games').set('Authorization', `Bearer ${token}`).expect(401)
  })
  it('slides sessions with bounded database writes, revokes other sessions on password changes, and limits attempts', async () => {
    const a = await start(), first = await login(a), second = await login(a)
    const rows = a.db.raw.prepare('SELECT hash, touched_at FROM sessions').all()
    await request(a.app).get('/api/me').set('Cookie', first).expect(200)
    expect(a.db.raw.prepare('SELECT hash, touched_at FROM sessions').all()).toEqual(rows)
    a.db.raw.exec('UPDATE sessions SET touched_at = touched_at - 600000')
    // New cache population sees the old touch time.
    await request(a.app).get('/api/me').set('Cookie', second).expect(200)
    expect(a.db.raw.prepare('SELECT MAX(touched_at) t FROM sessions').get()!.t).toBeGreaterThan(rows[0]!.touched_at as number - 10)
    await request(a.app).post('/api/me/password').set(site).set('Cookie', first).send({ current: 'correct password', password: 'a new password' }).expect(200)
    await request(a.app).get('/api/me').set('Cookie', second).expect(401)
    await request(a.app).get('/api/me').set('Cookie', first).expect(200)
    for (let i = 0; i < 8; i++) await request(a.app).post('/api/auth/login').set(site).send({ username: 'admin', password: 'bad' }).expect(401)
    await request(a.app).post('/api/auth/login').set(site).send({ username: 'admin', password: 'bad' }).expect(429)
    expect(a.app.get('trust proxy')).toBe(1)
  })
  it('switches a browser to someone who signed in on it, by their PIN, never to an admin, and locks after five wrong PINs', async () => {
    const a = await start(), admin = await login(a)
    const anna = await add(a, admin, 'anna'), benId = await add(a, admin, 'ben')
    await request(a.app).put('/api/me/pin').set(site).set('Cookie', admin).send({ pin: '1234' }).expect(409)
    // A browser: its own cookie stays through sign-ins and switches. Each call comes from its own address.
    let ip = 0
    const from = () => ({ ...site, 'X-Forwarded-For': `10.0.0.${++ip}` })
    const signIn = async (username: string, device = '') => {
      const res = await request(a.app).post('/api/auth/login').set(from()).set('Cookie', device).send({ username, password: username === 'admin' ? 'correct password' : 'player password' }).expect(200)
      const cookies = ([] as string[]).concat(res.headers['set-cookie']).map((c) => c.split(';')[0]!)
      const session = cookies.find((c) => c.startsWith('renplay_session='))!
      const browser = cookies.find((c) => c.startsWith('renplay_device=')) ?? device
      return { session, browser, both: `${session}; ${browser}` }
    }
    const annaHere = await signIn('anna'), browser = annaHere.browser
    expect(browser).toMatch(/^renplay_device=.{40,}/)
    await request(a.app).put('/api/me/pin').set(site).set('Cookie', annaHere.both).send({ pin: '12a4' }).expect(400)
    await request(a.app).put('/api/me/pin').set(site).set('Cookie', annaHere.both).send({ pin: '2468' }).expect(200)
    const me = (await request(a.app).get('/api/me').set('Cookie', annaHere.both).expect(200)).body.user
    expect(me).toMatchObject({ hasPin: true })
    expect(JSON.stringify(me)).not.toMatch(/pin_hash|scrypt/)
    expect(JSON.stringify((await request(a.app).get('/api/users').set('Cookie', admin).expect(200)).body)).not.toMatch(/pin_hash|scrypt/)
    // An access token cannot set a PIN.
    const { token } = (await request(a.app).post('/api/me/tokens').set(site).set('Cookie', annaHere.both).send({ name: 'phone' }).expect(200)).body
    await request(a.app).put('/api/me/pin').set('Authorization', `Bearer ${token}`).send({ pin: '1111' }).expect(403)
    // Only with a session, and only people who signed in on this browser, have a PIN and are not admins.
    await request(a.app).get('/api/auth/switch').expect(401)
    await signIn('admin', browser)
    const ben = await signIn('ben', browser)
    const listed = async (cookie: string) => (await request(a.app).get('/api/auth/switch').set('Cookie', cookie).expect(200)).body.people.map((p: { id: number }) => p.id)
    expect(await listed(ben.both)).toEqual([anna])
    // A browser where Anna never signed in lists nobody, and her PIN does not work there.
    const elsewhere = await signIn('ben')
    expect(elsewhere.browser).not.toBe(browser)
    expect(await listed(elsewhere.both)).toEqual([])
    const refused = await request(a.app).post('/api/auth/switch').set(from()).set('Cookie', elsewhere.both).send({ user: anna, pin: '2468' }).expect(403)
    // An admin, someone missing and a wrong PIN all get the same answer.
    for (const user of [1, 999]) expect((await request(a.app).post('/api/auth/switch').set(from()).set('Cookie', ben.both).send({ user, pin: '1234' }).expect(403)).body).toEqual(refused.body)
    // Tries sent at the same time count before they are checked: four wrong ones answer, the rest are locked out.
    const tries = await Promise.all(Array.from({ length: 8 }, () => request(a.app).post('/api/auth/switch').set(from()).set('Cookie', ben.both).send({ user: anna, pin: '0000' })))
    expect(tries.map((r) => r.status).sort()).toEqual([403, 403, 403, 403, 429, 429, 429, 429])
    expect(tries.find((r) => r.status === 403)!.body).toEqual(refused.body)
    await request(a.app).post('/api/auth/switch').set(from()).set('Cookie', ben.both).send({ user: anna, pin: '2468' }).expect(429)
    a.db.raw.prepare('UPDATE users SET pin_locked_until = 0 WHERE id = ?').run(anna)
    const switched = await request(a.app).post('/api/auth/switch').set(from()).set('Cookie', ben.both).send({ user: anna, pin: '2468' }).expect(200)
    const sessions = ([] as string[]).concat(switched.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]!).filter((c) => c.startsWith('renplay_session='))
    // A browser keeps the last cookie of a name: the new person's must come last.
    const annaAgain = sessions[sessions.length - 1]!
    expect(annaAgain).not.toBe(ben.session)
    expect((await request(a.app).get('/api/me').set('Cookie', `${annaAgain}; ${browser}`).expect(200)).body.user.username).toBe('anna')
    // Ben is signed out on this browser, and still listed in it for switching back.
    await request(a.app).get('/api/me').set('Cookie', ben.both).expect(401)
    // Clearing the PIN takes the person off every switch list.
    await request(a.app).put('/api/me/pin').set(site).set('Cookie', `${annaAgain}; ${browser}`).send({ pin: '' }).expect(200)
    const benAgain = await signIn('ben', browser)
    expect(await listed(benAgain.both)).toEqual([])
    // Signing out everywhere clears the PIN and makes other browsers forget the person.
    const annaThere = await signIn('anna', elsewhere.browser)
    await request(a.app).put('/api/me/pin').set(site).set('Cookie', annaThere.both).send({ pin: '1357' }).expect(200)
    expect(await listed(benAgain.both)).toEqual([anna])
    await request(a.app).delete('/api/me/sessions').set(site).set('Cookie', annaThere.both).expect(200)
    expect((await request(a.app).get('/api/me').set('Cookie', annaThere.both).expect(200)).body.user.hasPin).toBe(false)
    await request(a.app).put('/api/me/pin').set(site).set('Cookie', annaThere.both).send({ pin: '1357' }).expect(200)
    expect(await listed(benAgain.both)).toEqual([])
    expect(await listed((await signIn('ben', elsewhere.browser)).both)).toEqual([anna])
    expect(benId).toBeGreaterThan(anna)
  })

  it('runs as a demo: Try the demo signs in the shared guest, who plays but changes nothing of the server', async () => {
    // Not a demo: no guest, no route.
    const plain = await start()
    expect((await request(plain.app).get('/api/auth/providers').expect(200)).body.demo).toBe(false)
    await request(plain.app).post('/api/auth/demo').set(site).expect(404)
    process.env['RENPLAY_DEMO'] = 'on'
    const cfg = config()
    delete process.env['RENPLAY_DEMO']
    cfg.auth = 'off'
    const a = await start(cfg)
    game(a)
    const providers = (await request(a.app).get('/api/auth/providers').expect(200)).body
    expect(providers).toMatchObject({ enabled: true, demo: true, setup: false })
    const res = await request(a.app).post('/api/auth/demo').set(site).expect(200)
    const guest = ([] as string[]).concat(res.headers['set-cookie']).map((c) => c.split(';')[0]!).find((c) => c.startsWith('renplay_session='))!
    const me = (await request(a.app).get('/api/me').set('Cookie', guest).expect(200)).body
    expect(me).toMatchObject({ demo: true, user: { username: 'demo', role: 'player' } })
    expect((await request(a.app).get('/api/me/adult').set('Cookie', guest).expect(200)).body).toMatchObject({ choice: 'blurred', ceiling: { level: 'blurred' } })
    // A visitor plays: lists games, rates, saves a small file.
    await request(a.app).get('/api/games').set('Cookie', guest).expect(200)
    await request(a.app).put('/api/games/safe/rating').set(site).set('Cookie', guest).send({ rating: 4 }).expect(200)
    await request(a.app).put('/api/saves/safe/file?path=safe/1-1-LT1.save').set(site).set('Cookie', guest).set('Content-Type', 'application/octet-stream').send(Buffer.from('a save')).expect(200)
    // A huge file is not a save, and it is refused before it is read whole.
    await request(a.app).put('/api/saves/safe/file?path=safe/big.save').set(site).set('Cookie', guest).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(9 << 20)).expect(413)
    // Nothing that changes the shared account or adds files to the server.
    for (const [method, path, body] of [
      ['put', '/api/me', { name: 'Mine now' }],
      ['post', '/api/me/password', { current: 'x', password: 'another password' }],
      ['put', '/api/me/pin', { pin: '1234' }],
      ['post', '/api/me/tokens', { name: 'keep' }],
      ['delete', '/api/me/sessions', undefined],
      ['get', '/api/me/sessions', undefined],
      ['post', '/api/games/safe/art/upload?kind=grid', undefined],
      ['post', '/api/saves/safe/sync', { tz: 'UTC' }],
      // Saves come only from playing: no imports, copies or a new save folder for everyone.
      ['post', '/api/saves/safe/import', undefined],
      ['post', '/api/saves/safe/copy', { from: 'safe', to: 'other' }],
      ['post', '/api/saves/safe/save-dir', { saveDir: 'x', screen: [19999, 19999] }],
      // Choices every visitor would share.
      ['put', '/api/me/tags', { include: [], exclude: ['romance'] }],
      ['put', '/api/me/adult', { level: 'off' }],
    ] as const) await (request(a.app) as any)[method](path).set(site).set('Cookie', guest).send(body).expect(403)
    // No other way in: not even the admin's password works in a demo.
    await request(a.app).post('/api/auth/login').set(site).send({ username: 'admin', password: 'correct password' }).expect(403)
    await request(a.app).post('/api/auth/setup/verify').set(site).send({ code: 'X' }).expect(403)
    // Admin pages stay closed, as for any player.
    await request(a.app).get('/api/system').set('Cookie', guest).expect(403)
    await request(a.app).post('/api/imports').set(site).set('Cookie', guest).send({}).expect(403)
    // The guest is made once.
    const again = await createApp(cfg, { startJobs: false }); apps.push(again)
    expect(again.db.raw.prepare("SELECT COUNT(*) n FROM users WHERE username = 'demo'").get()).toMatchObject({ n: 1 })
  })

  it('maps all management route families to admins and keeps the last admin', async () => {
    const a = await start(), admin = await login(a), id = await add(a, admin), player = await login(a, 'player', 'player password'); game(a)
    const routes: [string, string][] = [['get', '/api/archives'], ['post', '/api/archives/inspect'], ['post', '/api/archives/hash'], ['delete', '/api/archives'], ['post', '/api/imports'], ['post', '/api/uploads'], ['get', '/api/uploads/u1'], ['put', '/api/uploads/u1'], ['post', '/api/uploads/u1/complete'], ['delete', '/api/uploads/u1'], ['get', '/api/games/safe/files'], ['put', '/api/games/safe/files/raw'], ['delete', '/api/games/safe/files/raw'], ['get', '/api/games/safe/files/raw'], ['post', '/api/games/safe/files/upload'], ['post', '/api/games/safe/files/revert'], ['post', '/api/games/safe/files/apply'], ['post', '/api/games/safe/files/reset'], ['delete', '/api/games/safe'], ['post', '/api/games/safe/reinstall'], ['post', '/api/games/safe/walkthroughs'], ['delete', '/api/games/safe/walkthroughs/safe.pdf'], ['put', '/api/games/safe/cache'], ['get', '/api/games/safe/recipe'], ['get', '/api/system'], ['post', '/api/system/prune'], ['post', '/api/system/engines/refresh'], ['get', '/api/jobs'], ['get', '/api/jobs/j1/log'], ['post', '/api/jobs/j1/cancel'], ['post', '/api/jobs/j1/retry'], ['delete', '/api/jobs'], ['post', '/api/catalog/refresh'], ['put', '/api/content'], ['get', '/api/users'], ['post', '/api/users'], ['put', `/api/users/${id}`], ['delete', `/api/users/${id}`], ['post', `/api/users/${id}/password`], ['post', `/api/users/${id}/merge`], ['post', `/api/users/${id}/saves/copy`], ['get', `/api/users/${id}/saves/export`], ['post', `/api/users/${id}/saves/import`], ['post', '/api/games/safe/safe'], ['get', '/api/system/backups'], ['post', '/api/system/backups'], ['get', '/api/system/backups/saves-2026-01-01-000000.zip'], ['put', '/api/system/sync'], ['get', '/api/metrics'], ['get', '/api/system/storage'], ['put', '/api/defaults']]
    for (const [method, path] of routes) {
      expect(playerRoute(method.toUpperCase(), path), path).toBe(false)
      await (request(a.app) as any)[method](path).set(site).set('Cookie', player).expect(403)
    }
    await request(a.app).put('/api/users/1').set(site).set('Cookie', admin).send({ role: 'player' }).expect(409)
    await request(a.app).put('/api/users/1').set(site).set('Cookie', admin).send({ disabled: true }).expect(409)
    await request(a.app).delete('/api/users/1').set(site).set('Cookie', admin).expect(409)
    await request(a.app).get('/api/games').set('Cookie', player).expect(200)
    // A player imports their own saves from a computer.
    expect(playerRoute('GET', '/api/saves-import') && playerRoute('POST', '/api/saves-import')).toBe(true)
    expect((await request(a.app).get('/api/saves-import').set('Cookie', player).expect(200)).body).toHaveProperty('dirs')
    expect((await request(a.app).get('/api/widget').set('Cookie', player).expect(200)).body).toHaveProperty('recent')
    // Where Your recipes live on the server is for admins.
    const folder = async (cookie: string) => (await request(a.app).get('/api/catalog').set('Cookie', cookie).expect(200)).body.status.sources.find((s: { kind: string }) => s.kind === 'folder').location
    expect(await folder(player)).toBe('')
    expect(await folder(admin)).toMatch(/recipes$/)
    await request(a.app).put('/api/games/safe/favorite').set(site).set('Cookie', player).send({ on: true }).expect(200)
  })
})

describe('personal data and save moves', () => {
  it('replays the real Ren’Py mirror and boot queue into A’s server folder after A → offline write → B → A', async () => {
    const a = await start(), admin = await login(a), id = await add(a, admin), player = await login(a, 'player', 'player password'); game(a)
    const indexedDB = sharedMirror()
    const serverFetch = (userId: number, cookie: string) => vi.fn(async (input: unknown, init: any = {}) => {
      const method = String(init.method ?? 'GET').toLowerCase()
      let call = (request(a.app) as any)[method](String(input)).set(site).set('Cookie', cookie).set('X-Renplay-User', String(userId))
      for (const [name, value] of new Headers(init.headers ?? {})) call = call.set(name, value)
      if (init.body) call = call.send(Buffer.from(init.body))
      const response = await call
      const json = String(response.headers['content-type']).includes('json')
      return new Response(json ? response.text : response.body, { status: response.status, headers: response.headers })
    })
    // Even a newer server copy must not cause an unsent browser write to be dropped: history keeps both.
    await a.saves.write('safe', 'persistent', Buffer.from('server copy'), { mtimeMs: Date.now() })
    const owner = renpyRuntime({ userId: 1, game: 'safe', indexedDB, fetch: vi.fn(async () => { throw new TypeError('Offline') }) })
    owner.write('safe/persistent', new Uint8Array(Buffer.from('offline A')), 10)
    await owner.idle()
    await vi.waitFor(async () => expect(await owner.entries()).toMatchObject([{ key: '1:safe/persistent', userId: 1, synced: 0 }]))
    const other = renpyRuntime({ userId: id, game: 'safe', indexedDB, fetch: serverFetch(id, player) })
    await other.boot()
    expect(other.read('safe/persistent')).toBeNull()
    expect((await other.entries()).filter((entry) => entry.userId === id)).toEqual([])
    other.write('safe/persistent', new Uint8Array(Buffer.from('online B')), 11)
    await other.idle()
    await vi.waitFor(async () => expect((await a.services.saveStores.of(id).read('safe', 'persistent')).toString()).toBe('online B'))
    await other.boot()
    const returning = renpyRuntime({ userId: 1, game: 'safe', indexedDB, fetch: serverFetch(1, admin) })
    expect((await returning.entries()).filter((entry) => entry.userId === 1)).toMatchObject([{ synced: 0 }])
    await returning.boot()
    await returning.idle()
    expect((await a.saves.read('safe', 'persistent')).toString()).toBe('offline A')
    expect((await a.services.saveStores.of(id).read('safe', 'persistent')).toString()).toBe('online B')
    expect(await a.saves.history('safe', 'persistent')).toHaveLength(1)
  })
  it('runs shared background jobs outside the enqueuing account context', async () => {
    const a = await start(), admin = await login(a), id = await add(a, admin)
    let seen: unknown = 'not run'
    a.jobs.register('account-context', 'Test', async () => { await Promise.resolve(); seen = viewer() })
    viewers.run({ user: a.accounts.user(id), session: 'fixture', bearer: false }, () => a.jobs.enqueue('account-context', '', {}))
    await vi.waitFor(() => expect(a.db.listJobs()[0]!.status).toBe('done'))
    expect(seen).toBeUndefined()
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
  it('isolates saves, history, metadata, shared data and progress, and protects runtime writes after an account switch', async () => {
    const a = await start(), admin = await login(a), id = await add(a, admin), player = await login(a, 'player', 'player password'); game(a)
    for (const [cookie, value] of [[admin, 'owner'], [player, 'player']]) {
      await request(a.app).put('/api/saves/safe/file?path=safe/persistent').set(site).set('Cookie', cookie!).set('Content-Type', 'application/octet-stream').send(Buffer.from(value!)).expect(200)
      await request(a.app).put('/api/saves/safe/file?path=persistent/shared').set(site).set('Cookie', cookie!).set('Content-Type', 'application/octet-stream').send(Buffer.from(value!)).expect(200)
      await request(a.app).post('/api/games/safe/played').set(site).set('Cookie', cookie!).send({}).expect(200)
    }
    await request(a.app).put('/api/games/safe/favorite').set(site).set('Cookie', player).send({ on: true }).expect(200)
    await request(a.app).put('/api/games/safe/status').set(site).set('Cookie', player).send({ status: 'finished' }).expect(200)
    await request(a.app).post('/api/games/safe/play-time').set(site).set('Cookie', player).send({ seconds: 23 }).expect(200)
    const personal = (await request(a.app).get('/api/games/safe').set('Cookie', player)).body.game
    expect(personal).toMatchObject({ playTime: 23, saves: { count: 0 } }); expect(personal.favoriteAt).toBeTruthy(); expect(personal.finishedAt).toBeTruthy()
    const owner = (await request(a.app).get('/api/games/safe').set('Cookie', admin)).body.game
    expect(owner).toMatchObject({ playTime: 0, favoriteAt: null, finishedAt: null })
    expect((await a.services.saveStores.of(id).read('safe', 'persistent')).toString()).toBe('player')
    expect((await a.saves.read('safe', 'persistent')).toString()).toBe('owner')
    await request(a.app).put('/api/saves/safe/file?path=safe/persistent').set(site).set('Cookie', player).set('X-Renplay-User', '1').send('wrong account').expect(401)
    await request(a.app).get('/api/saves/safe/screenshot?user=1&file=a.save').set('Cookie', player).expect(404)
    for (const [store, label] of [[a.saves, 'owner'], [a.services.saveStores.of(id), 'other']] as const) {
      await store.write('safe', '1-1-LT1.save', await zipBuffer({ log: 'x', json: JSON.stringify({ _save_name: label, _ctime: 10 }), 'screenshot.png': label }), { mtimeMs: 10000 })
    }
    const library = async (cookie: string) => (await request(a.app).get('/api/games/safe').set('Cookie', cookie)).body.game
    expect((await library(admin)).latestSave.name).toBe('owner')
    expect((await library(player)).latestSave.name).toBe('other')
    const ownerScreenshot = (await library(admin)).latestSave.screenshot
    const playerScreenshot = (await library(player)).latestSave.screenshot
    expect(ownerScreenshot).not.toBe(playerScreenshot)
    expect((await request(a.app).get(playerScreenshot).set('Cookie', player)).body.toString()).toBe('other')
    await request(a.app).get(ownerScreenshot).set('Cookie', player).expect(404)
    const tag = JSON.parse(readFileSync(join(a.services.saveStores.of(id).root, '..', 'user.json'), 'utf-8'))
    expect(tag).toMatchObject({ id, name: 'player' })
  })
  it('lets an existing admin claim the unclaimed owner, keeping both accounts’ saves and archiving the old folder', async () => {
    const cfg = config(); cfg.auth = 'off'
    let a = await start(cfg, false); game(a)
    const id = (await request(a.app).post('/api/users').send({ username: 'another', role: 'admin', password: 'another password' }).expect(201)).body.user.id
    await a.saves.write('safe', 'persistent', Buffer.from('owner'))
    await a.services.saveStores.of(id).write('safe', 'persistent', Buffer.from('another'))
    a.close(); apps.pop(); cfg.auth = 'on'; a = await start(cfg, false)
    const cookie = await login(a, 'another', 'another password')
    await request(a.app).post('/api/me/claim-owner').set(site).set('Cookie', cookie).expect(200)
    expect((await request(a.app).get('/api/me').set('Cookie', cookie)).body.user).toMatchObject({ id: 1, username: 'another' })
    expect((await a.saves.read('safe', 'persistent')).toString()).toBe('another')
    expect(await a.saves.history('safe', 'persistent')).toHaveLength(1)
    expect(readdirSync(join(cfg.dataDir, 'users-removed'))).toHaveLength(1)
  })
  it('keeps the last admin during concurrent removals and prevents stale writes from recreating archived users', async () => {
    const a = await start(), owner = await login(a)
    const cookies: string[] = [], ids: number[] = []
    for (const username of ['first-admin', 'second-admin']) {
      const response = await request(a.app).post('/api/users').set(site).set('Cookie', owner).send({ username, role: 'admin', password: 'admin password' }).expect(201)
      ids.push(response.body.user.id)
      cookies.push(await login(a, username, 'admin password'))
    }
    await request(a.app).put('/api/users/1').set(site).set('Cookie', owner).send({ role: 'player' }).expect(200)
    const stores = ids.map((id) => a.services.saveStores.of(id))
    await Promise.all(stores.map((store) => store.write('safe', 'persistent', Buffer.from('kept'))))
    const results = await Promise.all(ids.map((id, i) => request(a.app).delete(`/api/users/${id}`).set(site).set('Cookie', cookies[i]!)))
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(a.db.raw.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0").get()!.n).toBe(1)
    const removed = results.findIndex((response) => response.status === 200)
    await expect(stores[removed]!.write('safe', 'persistent', Buffer.from('late write'))).rejects.toThrow('being archived')
    expect(() => a.services.saveStores.of(ids[removed])).toThrow('User not found')
    const archived = readdirSync(join(a.accounts.cfg.dataDir, 'users-removed'))[0]!
    expect(readFileSync(join(a.accounts.cfg.dataDir, 'users-removed', archived, 'saves', 'safe', 'persistent'), 'utf-8')).toBe('kept')
  })
  it('copies one game or all, preserves target history and signing keys, exports/imports HTML data, merges and archives users', async () => {
    const a = await start(), admin = await login(a), id = await add(a, admin); game(a)
    await a.saves.write('safe', 'persistent', Buffer.from('owner'))
    await a.saves.write('safe', 'localStorage.json', Buffer.from('{"owner":1}'))
    await a.saves.write('safe', 'indexedDB.json', Buffer.from('{"owner":2}'))
    await a.saves.write('tokens', 'security_keys.txt', Buffer.from('signing-key AAA BBB\n'))
    await a.services.saveStores.of(id).write('tokens', 'security_keys.txt', Buffer.from('signing-key CCC DDD\n'))
    await a.services.saveStores.of(id).write('safe', 'persistent', Buffer.from('target'))
    await request(a.app).post('/api/users/1/saves/copy').set(site).set('Cookie', admin).send({ target: id, game: 'safe' }).expect(200)
    expect((await a.services.saveStores.of(id).history('safe', 'persistent'))[0]!.reason).toBe('user-copy')
    expect((await a.services.saveStores.of(id).read('tokens', 'security_keys.txt')).toString()).toContain('verifying-key BBB')
    const history = (await a.services.saveStores.of(id).history('safe', 'persistent'))[0]!
    expect(readFileSync(join(a.services.saveStores.of(id).historyRoot, 'safe', history.id), 'utf-8')).toBe('target')
    await request(a.app).post('/api/users/1/saves/copy').set(site).set('Cookie', admin).send({ target: id }).expect(200)
    expect((await a.services.saveStores.of(id).read('tokens', 'security_keys.txt')).toString()).toContain('signing-key CCC DDD')
    expect((await a.services.saveStores.of(id).read('tokens', 'security_keys.txt')).toString()).toContain('verifying-key BBB')
    const exported = await request(a.app).get('/api/users/1/saves/export').set('Cookie', admin).responseType('blob').expect(200)
    await request(a.app).post(`/api/users/${id}/saves/import`).set(site).set('Cookie', admin).attach('file', exported.body, 'saves.zip').expect(200)
    expect((await a.services.saveStores.of(id).read('safe', 'indexedDB.json')).toString()).toBe('{"owner":2}')
    await request(a.app).post(`/api/users/${id}/saves/import`).set(site).set('Cookie', admin).attach('file', await zipBuffer({ 'root.txt': 'no folder' }), 'bad.zip').expect(400)
    await request(a.app).post(`/api/users/${id}/merge`).set(site).set('Cookie', admin).send({ target: 1 }).expect(200)
    expect(() => a.accounts.user(id)).toThrow('User not found')
    expect(readdirSync(join(a.accounts.cfg.dataDir, 'users-removed'))[0]).toMatch(new RegExp(`^${id}-`))
  })
  it('keeps data across off, on, off and on again, optionally choosing the no-sign-in user', async () => {
    const cfg = config(); cfg.auth = 'off'
    let a = await start(cfg, false); game(a)
    await request(a.app).put('/api/saves/safe/file?path=safe/persistent').set('Content-Type', 'application/octet-stream').send(Buffer.from('off')).expect(200)
    a.close(); apps.pop(); cfg.auth = 'on'
    a = await start(cfg); let admin = await login(a); const id = await add(a, admin)
    await a.services.saveStores.of(id).write('safe', 'persistent', Buffer.from('personal'))
    await a.saves.write('safe', 'persistent', Buffer.from('on-owner'))
    a.close(); apps.pop(); cfg.auth = 'off'
    a = await start(cfg)
    expect((await request(a.app).get('/api/saves/safe/raw?path=safe/persistent')).body.toString()).toBe('on-owner')
    await a.saves.write('safe', 'persistent', Buffer.from('off-again'))
    expect((await a.services.saveStores.of(id).read('safe', 'persistent')).toString()).toBe('personal')
    a.close(); apps.pop(); cfg.authUser = id
    a = await start(cfg)
    expect((await request(a.app).get('/api/saves/safe/raw?path=safe/persistent')).body.toString()).toBe('personal')
    a.close(); apps.pop(); cfg.auth = 'on'; cfg.authUser = 1
    a = await start(cfg); admin = await login(a)
    expect((await a.saves.read('safe', 'persistent')).toString()).toBe('off-again')
    expect((await a.saves.history('safe', 'persistent')).length).toBe(2)
    const player = await login(a, 'player', 'player password')
    expect((await request(a.app).get('/api/saves/safe/raw?path=safe/persistent').set('Cookie', player)).body.toString()).toBe('personal')
  })
})

describe('adult access and signed game URLs', () => {
  it('enforces adult and unknown game access on saves, raw paths, library, static files and play, with an admin safe flag', async () => {
    const a = await start(), admin = await login(a), id = await add(a, admin), player = await login(a, 'player', 'player password')
    game(a); game(a, 'adult', { adult: 1 }); game(a, 'unknown', { recipe_id: '' })
    await a.services.saveStores.of(id).write('adult', 'persistent', Buffer.from('adult'))
    expect((await request(a.app).get('/api/games').set('Cookie', player)).body.games.map((g: any) => g.id)).toEqual(['safe'])
    for (const path of ['/api/games/adult', '/api/saves/adult', '/api/saves/adult/boot', '/api/saves/adult/export', '/g/adult/b1/', '/g/adult/b1/game.zip', '/api/saves/safe/raw?path=adult/persistent']) await request(a.app).get(path).set('Cookie', player).expect(404)
    expect((await request(a.app).get('/api/saves/safe/boot').set('Cookie', player)).body.lazy).toEqual([])
    await request(a.app).post('/api/saves/safe/save-dir').set(site).set('Cookie', player).send({ saveDir: 'adult' }).expect(404)
    await a.services.saveStores.of(id).write('orphan', 'persistent', Buffer.from('unclassified'))
    await request(a.app).post('/api/saves/safe/save-dir').set(site).set('Cookie', player).send({ saveDir: 'orphan' }).expect(404)
    await request(a.app).post('/api/saves/safe/save-dir').set(site).set('Cookie', player).send({ saveDir: 'tokens' }).expect(400)
    expect(a.db.getGame('safe')!.save_dir).toBe('safe')
    for (const path of ['/g/adult/b1/game.zip', '/g//adult/b1/game.zip', '/g/', '/g/safe/', '/api/covers/', '/api/covers//adult.webp', '/api/walkthroughs//adult.pdf']) {
      await request(a.app).get('/api/auth/check').set('Cookie', player).set('X-Original-URI', path).expect(403)
    }
    await request(a.app).get('/api/auth/check').set('Cookie', player).set('X-Original-URI', '/g/safe/b1/../../adult/b1/game.zip').expect(403)
    await request(a.app).get('/api/auth/check').set('Cookie', player).set('X-Original-URI', '/g/safe/b1/%2e%2e/%2e%2e/adult/b1/game.zip').expect(403)
    await request(a.app).post('/api/games/unknown/safe').set(site).set('Cookie', admin).send({ safe: true }).expect(200)
    expect((await request(a.app).get('/api/games/unknown').set('Cookie', player)).body.game.id).toBe('unknown')
    await request(a.app).put(`/api/users/${id}`).set(site).set('Cookie', admin).send({ adultCeiling: 'shown' }).expect(200)
    // The ceiling is only the maximum: the person's own choice still starts where it was.
    await request(a.app).get('/api/games/adult').set('Cookie', player).expect(404)
    await request(a.app).put('/api/me/adult').set(site).set('Cookie', player).send({ level: 'shown' }).expect(200)
    await request(a.app).get('/api/games/adult').set('Cookie', player).expect(200)
    await request(a.app).put('/api/me/adult').set(site).set('Cookie', player).send({ level: 'off' }).expect(200)
    await request(a.app).get('/api/games/adult').set('Cookie', player).expect(404)
  })
  it('filters catalog recipes and their pictures and walkthroughs by adult access, including nginx checks', async () => {
    const cfg = config(), db = Db.open(cfg.dataDir)
    // Each recipe's grid is in the art cache's originals already, so it is made without a download.
    const art = async (id: string) => {
      const data = await sharp({ create: { width: 600, height: 900, channels: 3, background: id === 'adult' ? '#a33' : '#3a3' } }).png().toBuffer()
      const sha256 = createHash('sha256').update(data).digest('hex')
      mkdirSync(join(cfg.dataDir, 'art', 'src'), { recursive: true })
      writeFileSync(join(cfg.dataDir, 'art', 'src', sha256), data)
      return [{ kind: 'grid', url: `https://art.example/${id}.png`, source: 'steam', sha256, width: 600, height: 900 }]
    }
    db.setSetting('catalog_cache', { at: Date.now(), games: [{ id: 'safe', title: 'Safe', art: await art('safe'), releases: [] }, { id: 'adult', title: 'Adult', nsfw: true, art: await art('adult'), releases: [] }] })
    db.close()
    const a = await start(cfg), admin = await login(a); await add(a, admin); const player = await login(a, 'player', 'player password')
    for (const id of ['safe', 'adult']) { game(a, id, { recipe_id: id, adult: id === 'adult' ? 1 : 0, walkthroughFile: `${id}.pdf` }); writeFileSync(join(cfg.walkthroughsDir, `${id}.pdf`), 'pdf') }
    await a.catalog.syncArt()
    const picture = (id: string) => (a.catalog.recipeArt(a.catalog.recipe(id)!) as Record<string, { url1x: string }>)['grid']!.url1x
    const adultPic = picture('adult'), safePic = picture('safe')
    expect((await request(a.app).get('/api/catalog').set('Cookie', player)).body.games.map((g: any) => g.id)).toEqual(['safe'])
    for (const file of [adultPic, '/api/walkthroughs/adult.pdf']) {
      await request(a.app).get(file).set('Cookie', player).expect(404)
      await request(a.app).get('/api/auth/check').set('Cookie', player).set('X-Original-URI', file).expect(403)
      await request(a.app).get(file).set('Cookie', admin).expect(200)
    }
    await request(a.app).get(safePic).set('Cookie', player).expect(200)
    await request(a.app).get('/api/auth/check').set('Cookie', player).set('X-Original-URI', safePic).expect(204)
  })
  it('sandboxes every HTML pack response regardless of filename or MIME and permits encoded filenames', async () => {
    const a = await start(), cookie = await login(a)
    game(a, 'html', { family: 'html', entry: 'index.html' })
    const root = join(a.accounts.cfg.gamesDir, 'html', 'b1'); mkdirSync(root, { recursive: true })
    const names = ['index.html', 'attack.htm', 'attack.xhtml', 'attack.svg', 'attack.xml', 'attack.html.gz', 'attack.html.br', 'attack.svg.br', 'attack.xml.gz', 'attack.html.gz.br', 'unknown', 'UPPER.HTML', 'image #1.png', '100%.png', 'what?.png']
    const page = '<!doctype html><html><body>Fixture</body></html>'
    writeFileSync(join(root, 'assets.pack'), names.map(() => page).join(''))
    writeFileSync(join(root, 'assets.json'), JSON.stringify(Object.fromEntries(names.map((name, i) => [name, [i * Buffer.byteLength(page), Buffer.byteLength(page)]]))))
    const url = (await request(a.app).get('/api/games/html').set('Cookie', cookie).expect(200)).body.game.playUrl as string
    for (const name of names) {
      const response = await request(a.app).get(url.replace('index.html', encodeURIComponent(name)))
      expect(response.status, name).toBe(200)
      expect(response.headers['content-security-policy'], name).toBe("sandbox allow-scripts allow-modals allow-pointer-lock allow-popups allow-downloads allow-forms; frame-ancestors 'self'")
      expect(response.headers['x-content-type-options'], name).toBe('nosniff')
      if (['image #1.png', '100%.png', 'what?.png'].includes(name)) expect(response.body.toString(), name).toBe(page)
    }
    const range = await request(a.app).get(url.replace('index.html', 'attack.html.gz')).set('Range', 'bytes=0-9').expect(206)
    expect(range.headers['content-security-policy']).toMatch(/^sandbox /)
    expect(range.headers['x-content-type-options']).toBe('nosniff')
    for (const name of ['../index.html', 'a//index.html', 'a%2findex.html', 'a%5cindex.html', 'a\\index.html', 'a\0index.html']) {
      expect((await request(a.app).get(url.replace('index.html', encodeURIComponent(name)))).status, name).toBeGreaterThanOrEqual(400)
    }
  })
  it('serves an RPG Maker game the decrypted file for the plain name of an encrypted one', async () => {
    const a = await start(), cookie = await login(a)
    const key = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    const png = Buffer.from('\x89PNG\r\n\x1a\n0000IHDR and the rest of the picture', 'latin1')
    const encrypted = Buffer.concat([Buffer.from('5250474d560000000003010000000000', 'hex'), png.map((b, i) => (i < 16 ? b ^ key[i]! : b))])
    const files: Array<[string, Buffer]> = [['index.html', Buffer.from('<html></html>')], ['data/System.json', Buffer.from(JSON.stringify({ encryptionKey: key.toString('hex') }))], ['img/pictures/pic_01.rpgmvp', encrypted]]
    for (const [id, family] of [['rpgm', 'html'], ['vn', 'renpy']] as const) {
      game(a, id, { family, entry: 'index.html' })
      const root = join(a.accounts.cfg.gamesDir, id, 'b1'); mkdirSync(root, { recursive: true })
      let at = 0
      writeFileSync(join(root, 'assets.pack'), Buffer.concat(files.map(([, data]) => data)))
      writeFileSync(join(root, 'assets.json'), JSON.stringify(Object.fromEntries(files.map(([name, data]) => [name, [(at += data.length) - data.length, data.length]]))))
    }
    const url = (await request(a.app).get('/api/games/rpgm').set('Cookie', cookie).expect(200)).body.game.playUrl as string
    const plain = url.replace('index.html', 'img/pictures/pic_01.png')
    const whole = await request(a.app).get(plain).buffer(true).parse((r, done) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => done(null, Buffer.concat(c))) }).expect(200)
    expect(whole.body).toEqual(png)
    expect(whole.headers['content-type']).toBe('image/png')
    expect(whole.headers['content-security-policy']).toMatch(/^sandbox /)
    expect((await request(a.app).get(plain).set('Range', 'bytes=1-3').expect(206)).headers['content-range']).toBe(`bytes 1-3/${png.length}`)
    expect((await request(a.app).head(plain).expect(200)).headers['content-length']).toBe(String(png.length))
    await request(a.app).get(url.replace('index.html', 'img/pictures/missing.png')).expect(404)
    // A Ren'Py game's files are only ever its own: the encrypted file is there, its plain name is not.
    await request(a.app).get('/g/vn/b1/game/img/pictures/pic_01.rpgmvp').set('Cookie', cookie).expect(200)
    await request(a.app).get('/g/vn/b1/game/img/pictures/pic_01.png').set('Cookie', cookie).expect(404)
  })
  it('binds sandboxed HTML URLs to user, game, build and live session and revokes them on sign-out', async () => {
    const a = await start(), admin = await login(a), id = await add(a, admin), player = await login(a, 'player', 'player password')
    game(a, 'html', { family: 'html', entry: 'index.html' })
    const root = join(a.accounts.cfg.gamesDir, 'html', 'b1'); mkdirSync(root, { recursive: true })
    const page = '<html><head></head><body>Fixture</body></html>'
    writeFileSync(join(root, 'assets.pack'), page + page); writeFileSync(join(root, 'assets.json'), JSON.stringify({ 'index.html': [0, Buffer.byteLength(page)], 'secondary.html': [Buffer.byteLength(page), Buffer.byteLength(page)] }))
    await a.saves.write('html', 'localStorage.json', Buffer.from('{"owner":"state"}'))
    await a.services.saveStores.of(id).write('html', 'localStorage.json', Buffer.from('{"player":"state"}'))
    const url = (await request(a.app).get('/api/games/html').set('Cookie', player).expect(200)).body.game.playUrl
    expect(url).toMatch(/^\/g\/html\/b1\/s\/.+\/game\/index.html$/)
    const response = await request(a.app).get(url).expect(200)
    expect(response.headers['content-security-policy']).toMatch(/^sandbox /)
    expect(response.headers['content-security-policy']).not.toMatch(/allow-same-origin|allow-popups-to-escape-sandbox/)
    const secondary = await request(a.app).get(url.replace('index.html', 'secondary.html')).expect(200)
    expect(secondary.headers['content-security-policy']).toBe(response.headers['content-security-policy'])
    await request(a.app).get('/g/html/b1/game/index.html?/s/forged').set('Cookie', player).expect(403)
    expect(response.text).toContain('"player":"state"'); expect(response.text).not.toContain('"owner":"state"'); expect(response.text).toContain(`"userId":${id}`)
    await request(a.app).get(url.replace('/b1/', '/b2/')).expect(401)
    await request(a.app).get(url.replace('/html/', '/another/')).expect(401)
    await request(a.app).get('/g/html/b1/game/index.html').set('Cookie', player).expect(403)
    await request(a.app).post('/api/auth/logout').set(site).set('Cookie', player).expect(200)
    await request(a.app).get(url).expect(401)
    await request(a.app).get('/api/auth/check').set('X-Original-URI', '/g/html/b1/game.zip').expect(401)
  })
})

