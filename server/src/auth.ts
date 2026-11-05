import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { mkdir, rename, writeFile, symlink, lstat } from 'node:fs/promises'
import { dirname as pathDirname, relative as pathRelative } from 'node:path'
import { join } from 'node:path'
import express, { Router, type Request, type Response } from 'express'
import type { Config } from './config.js'
import type { Db, GameRow } from './db.js'
import { parseJson } from './db.js'
import { viewer, viewers, type User, type Viewer } from './accounts-context.js'
import { SaveStore, SHARED_DIRS } from './saves/store.js'
import { readZipEntries } from './saves/savefile.js'
import { saveImport } from './saves/import-upload.js'
import { HttpError, cleanRelPath, isSaveDirName } from './util/paths.js'

// Measured locally at 207 ms (N=65536: 105 ms); explicit 128 MiB work factor.
const PASSWORD_PREFIX = 'scrypt$1$131072$8$1$'
const scrypt = (password: string, salt: string, N: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, 64, { N, r: 8, p: 1, maxmem: 256 << 20 }, (error, key) => error ? reject(error) : resolve(key))
})
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const random = () => randomBytes(32).toString('base64url')
const DAYS30 = 30 * 86400_000
export const keepaliveToken = random()

export async function passwordHash(password: unknown): Promise<string> {
  if (typeof password !== 'string' || password.length < 10 || password.length > 1024) throw new HttpError(400, 'Use a password with 10 to 1024 characters')
  const salt = randomBytes(16).toString('hex')
  return `${PASSWORD_PREFIX}${salt}$${(await scrypt(password, salt, 131072)).toString('hex')}`
}
async function passwordMatches(password: unknown, encoded: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 1024) return false
  const parts = encoded.split('$')
  const [salt, key] = parts.length === 1 ? encoded.split(':') : parts.slice(5)
  const N = parts.length === 1 ? 16384 : Number(parts[2])
  if (parts.length !== 1 && (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== '1' || parts[3] !== '8' || parts[4] !== '1' || ![16384, 65536, 131072].includes(N))) return false
  if (!salt || !key || !/^[0-9a-f]{128}$/.test(key)) return false
  const actual = await scrypt(password, salt, N)
  const expected = Buffer.from(key, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
function equal(a: string, b: string): boolean { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))) }
function username(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/.test(value)) throw new HttpError(400, 'Use 2 to 64 letters, numbers, dots, dashes or underscores for the username')
  return value.toLowerCase()
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new HttpError(400, 'Enter a name with at most 100 characters')
  return value.trim()
}

/** A closed player allowlist makes new management endpoints admin-only by default. */
export function playerRoute(method: string, path: string): boolean {
  if (/^\/api\/me(?:\/|$)/.test(path)) return true
  if (/^\/api\/saves(?:\/|$)/.test(path) || path === '/api/saves-export') return true
  if ((method === 'GET' || method === 'HEAD') && (/^\/g\//.test(path) || /^\/api\/(covers|walkthroughs)\//.test(path) || ['/api/games', '/api/catalog', '/api/content'].includes(path) || /^\/api\/games\/[^/]+$/.test(path))) return true
  return /^(PUT \/api\/games\/[^/]+\/(favorite|finished)|POST \/api\/games\/[^/]+\/(played|play-time))$/.test(`${method} ${path}`)
}

export class Accounts {
  readonly enabled: boolean
  private setupCode = randomBytes(9).toString('hex').toUpperCase()
  private attempts = 10
  private setupGrant = ''
  private readonly signingKey = random()
  private readonly stores = new Map<number, SaveStore>()
  private readonly removing = new Set<number>()
  private readonly limits = new Map<string, { count: number; until: number }>()
  private readonly sessionCache = new Map<string, { id: number; expires: number; touched: number; checked: number }>()
  private dummyPassword = ''
  constructor(readonly db: Db, readonly cfg: Config) {
    this.enabled = (cfg.auth || db.getSetting('auth_default', 'on')) === 'on'
  }
  get unclaimed(): boolean { return !(this.db.raw.prepare('SELECT 1 FROM identities WHERE user_id = 1').get()) }
  user(id: number): User {
    const u = this.db.raw.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as User | undefined
    if (!u) throw new HttpError(404, 'User not found')
    return u
  }
  current(): User {
    const user = viewer()?.user
    if (!user) throw new HttpError(401, 'Sign in to Renplay')
    return user
  }
  /** Only an upgraded single-user installation may attribute pre-account browser saves. */
  get legacySaveOwner(): number | null {
    return this.db.getSetting<string>('auth_default', 'on') === 'off' ? 1 : null
  }
  store(id = this.current().id): SaveStore {
    this.user(id)
    let s = this.stores.get(id)
    if (!s) {
      const root = join(this.cfg.dataDir, 'users', String(id))
      s = new SaveStore(join(root, 'saves'), join(root, 'save-history'), this.cfg.saveHistoryVersions)
      this.stores.set(id, s)
    }
    return s
  }
  async tag(u: User): Promise<void> {
    const root = join(this.cfg.dataDir, 'users', String(u.id))
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'user.json'), JSON.stringify({ id: u.id, name: u.name, created: u.created_at }) + '\n')
  }
  async init(): Promise<void> {
    this.dummyPassword = await passwordHash(random())
    if (this.enabled && !this.cfg.authLocal) throw new Error('No sign-in provider is enabled. Enable RENPLAY_AUTH_LOCAL or set RENPLAY_AUTH=off.')
    if (!!this.cfg.adminUsername !== !!this.cfg.adminPassword) throw new Error('Set both RENPLAY_ADMIN_USERNAME and RENPLAY_ADMIN_PASSWORD (or its _FILE variant)')
    if (this.unclaimed && this.cfg.adminUsername) await this.claim(this.cfg.adminUsername, this.cfg.adminUsername, this.cfg.adminPassword)
    if (this.enabled && this.unclaimed) console.log(`Setup code: ${this.setupCode}`)
    if (!this.enabled && this.user(this.cfg.authUser).disabled) throw new Error('RENPLAY_AUTH_USER is disabled')
    for (const u of this.db.raw.prepare('SELECT * FROM users').all() as unknown as User[]) await this.tag(u)
    for (const [legacy, target] of [[this.cfg.savesDir, this.store(1).root], [this.cfg.saveHistoryDir, this.store(1).historyRoot]]) {
      await mkdir(target!, { recursive: true })
      if (!await lstat(legacy!).catch(() => null)) { await mkdir(join(legacy!, '..'), { recursive: true }); await symlink(pathRelative(pathDirname(legacy!), target!), legacy!, 'dir') }
    }
  }
  private invalidate(): void { this.sessionCache.clear() }
  private async claim(raw: unknown, display: unknown, password: unknown): Promise<void> {
    const login = username(raw), displayName = name(display), encoded = await passwordHash(password)
    if (!this.unclaimed) throw new HttpError(409, 'The owner account is already claimed')
    if (this.db.raw.prepare('SELECT 1 FROM users WHERE username = ? AND id != 1').get(login)) throw new HttpError(409, 'That username is taken')
    this.db.raw.exec('BEGIN IMMEDIATE')
    try {
      this.db.raw.prepare("UPDATE users SET username = ?, name = ?, adult_access = 1 WHERE id = 1").run(login, displayName)
      this.db.raw.prepare("INSERT INTO identities VALUES ('local', ?, 1, ?)").run(login, encoded)
      this.db.raw.exec('COMMIT')
    } catch (e) { this.db.raw.exec('ROLLBACK'); throw e }
    await this.tag(this.user(1))
    this.setupGrant = ''; this.setupCode = ''
  }
  private limit(key: string): void {
    const now = Date.now()
    for (const [k, value] of this.limits) if (value.until <= now) this.limits.delete(k)
    const bucket = this.limits.get(key) ?? { count: 0, until: now + 60_000 }
    if (++bucket.count > 10) throw new HttpError(429, 'Too many tries. Wait a minute.')
    this.limits.set(key, bucket)
  }
  private secure(req: Request): boolean { return req.secure || this.cfg.publicUrl.startsWith('https://') }
  private cookie(req: Request, res: Response, value: string): void {
    res.cookie('renplay_session', value, { httpOnly: true, sameSite: 'lax', secure: this.secure(req), path: '/', maxAge: value ? DAYS30 : 0 })
  }
  private newSession(req: Request, res: Response, id: number): void {
    const token = random(), now = Date.now()
    this.db.raw.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)').run(hash(token), id, now, now, now + DAYS30, (req.get('user-agent') ?? '').slice(0, 200))
    this.cookie(req, res, token)
  }
  private session(key: string): Viewer | null {
    const now = Date.now()
    let cached = this.sessionCache.get(key)
    if (!cached || now - cached.checked > 5000) {
      const s = this.db.raw.prepare('SELECT * FROM sessions WHERE hash = ?').get(key) as { user_id: number; expires_at: number; touched_at: number } | undefined
      if (!s || s.expires_at <= now) { this.sessionCache.delete(key); return null }
      cached = { id: s.user_id, expires: s.expires_at, touched: s.touched_at, checked: now }
      if (this.sessionCache.size > 10000) this.sessionCache.clear()
      this.sessionCache.set(key, cached)
    }
    if (cached.expires <= now) return null
    const u = this.user(cached.id)
    if (u.disabled) return null
    if (now - cached.touched >= 300_000) {
      this.db.raw.prepare('UPDATE sessions SET touched_at = ?, expires_at = ? WHERE hash = ?').run(now, now + DAYS30, key)
      cached.touched = now; cached.expires = now + DAYS30
    }
    return { user: u, session: key, bearer: false }
  }
  private authenticate(req: Request, res: Response): Viewer | null {
    if (!this.enabled) return { user: this.user(this.cfg.authUser), session: `off-${this.cfg.authUser}`, bearer: false }
    const bearer = req.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (bearer) {
      const row = this.db.raw.prepare('SELECT user_id FROM tokens WHERE hash = ?').get(hash(bearer)) as { user_id: number } | undefined
      if (!row) return null
      const u = this.user(row.user_id)
      return u.disabled ? null : { user: u, session: hash(bearer), bearer: true }
    }
    const token = req.get('cookie')?.match(/(?:^|;\s*)renplay_session=([^;]+)/)?.[1]
    if (!token) return null
    const found = this.session(hash(token))
    if (found) this.cookie(req, res, token)
    return found
  }
  /** Cookie authentication does not constrain body type: raw, multipart and empty deletes work. */
  csrf(req: Request): void {
    if (!this.enabled || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || viewer()?.bearer) return
    const site = req.get('sec-fetch-site')
    if (site === 'same-origin' || site === 'none') return
    const origin = req.get('origin')
    if (site !== 'cross-site' && origin && [this.cfg.publicUrl && new URL(this.cfg.publicUrl).origin, `${req.protocol}://${req.get('host')}`].includes(origin)) return
    throw new HttpError(403, 'This request must come from this Renplay')
  }
  readonly middleware: express.RequestHandler = (req, res, next) => {
    if (req.path === '/api/health' || req.path === '/api/keepalive' || req.path.startsWith('/engine/') || req.path === '/renplay/runtime.js') return next()
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/g/')) return next()
    res.setHeader('Cache-Control', 'private, no-store')
    // Sandboxed HTML assets have no cookies. Their capability resolves to a live session.
    const signed = req.path.match(/^\/g\/([^/]+)\/([^/]+)\/s\/([^/]+)\/game\//)
    let v: Viewer | null
    if (signed) {
      v = this.verifyAsset(signed[3]!, signed[1]!, signed[2]!)
      res.locals.verifiedAsset = !!v
      req.url = req.url.replace(`/s/${signed[3]}/game/`, '/game/')
    } else v = this.authenticate(req, res)
    if (req.path.startsWith('/api/auth/') && req.path !== '/api/auth/check') {
      const proceed = () => { try { this.csrf(req); next() } catch (e) { next(e) } }
      return v ? viewers.run(v, proceed) : proceed()
    }
    if (!v) return next(new HttpError(401, 'Sign in to Renplay'))
    viewers.run(v, () => {
      try {
        this.csrf(req)
        const runtimeUser = req.get('x-renplay-user')
        if (runtimeUser !== undefined && runtimeUser !== String(v.user.id)) throw new HttpError(401, 'You were signed out')
        if (req.path !== '/api/auth/check' && v.user.role !== 'admin' && !playerRoute(req.method, req.path)) throw new HttpError(403, 'Only an admin can do this')
        next()
      } catch (e) { next(e) }
    })
  }
  assetUrl(game: GameRow): string {
    const v = viewer()
    if (!v) throw new HttpError(401, 'Sign in to Renplay')
    const signature = createHmac('sha256', this.signingKey).update(`${v.session}\n${game.id}\n${game.build}`).digest('base64url')
    return `/g/${game.id}/${game.build}/s/${v.session}.${signature}/game/${game.entry.split('/').map(encodeURIComponent).join('/')}`
  }
  private verifyAsset(token: string, game: string, build: string): Viewer | null {
    const [session, signature] = token.split('.')
    if (!session || !signature) return null
    const expected = createHmac('sha256', this.signingKey).update(`${session}\n${game}\n${build}`).digest('base64url')
    if (!equal(expected, signature)) return null
    if (!this.enabled) return session === `off-${this.cfg.authUser}` ? { user: this.user(this.cfg.authUser), session, bearer: false } : null
    const tokenUser = this.db.raw.prepare('SELECT user_id FROM tokens WHERE hash = ?').get(session) as { user_id: number } | undefined
    if (tokenUser) { const user = this.user(tokenUser.user_id); return user.disabled ? null : { user, session, bearer: true } }
    return this.session(session)
  }
  progress(row: GameRow): GameRow {
    const u = this.db.raw.prepare('SELECT favorite_at, finished_at, last_played_at, play_time FROM user_games WHERE user_id = ? AND game = ?').get(this.current().id, row.id)
    return { ...row, favorite_at: '', finished_at: '', last_played_at: '', play_time: 0, ...u }
  }
  setProgress(game: string, patch: Partial<Pick<GameRow, 'favorite_at' | 'finished_at' | 'last_played_at' | 'play_time'>>): void {
    const id = this.current().id
    this.db.raw.prepare('INSERT OR IGNORE INTO user_games (user_id, game) VALUES (?, ?)').run(id, game)
    for (const [key, value] of Object.entries(patch)) this.db.raw.prepare(`UPDATE user_games SET ${key} = ? WHERE user_id = ? AND game = ?`).run(value, id, game)
    if (patch.last_played_at) this.db.raw.prepare('UPDATE games SET last_played_at = MAX(last_played_at, ?) WHERE id = ?').run(patch.last_played_at, game)
  }
  private guardLastAdmin(target: User, patch: { role?: string; disabled?: boolean }, removing = false): void {
    if (target.role !== 'admin' || target.disabled || (!removing && patch.role !== 'player' && patch.disabled !== true)) return
    const { n } = this.db.raw.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0").get() as { n: number }
    if (n <= 1) throw new HttpError(409, 'Keep at least one enabled admin')
  }
  private revoke(id: number, except = ''): void {
    this.db.raw.prepare('DELETE FROM sessions WHERE user_id = ? AND hash != ?').run(id, except)
    this.invalidate()
  }
  private async copy(from: number, to: number, game?: string): Promise<number> {
    if (from === to) throw new HttpError(400, 'Choose two different users')
    this.user(from); this.user(to)
    const source = this.store(from), target = this.store(to)
    let dirs: string[]
    if (game) {
      const g = this.db.getGame(game)
      if (!g?.save_dir) throw new HttpError(404, 'Game save folder not found')
      dirs = [g.save_dir, 'tokens']
    } else dirs = [...await source.listDirs(), ...SHARED_DIRS]
    let copied = 0
    for (const dir of dirs) for (const file of await source.list(dir)) {
      const data = await source.read(dir, file.name)
      if (dir === 'tokens' && file.name === 'security_keys.txt') await target.mergeSecurityKeys(data.toString('utf-8'))
      else await target.write(dir, file.name, data, { reason: 'user-copy', mtimeMs: file.mtimeMs })
      copied++
    }
    return copied
  }
  private mergeProgress(from: number, to: number): void {
    this.db.raw.prepare(`INSERT INTO user_games SELECT ?, game, favorite_at, finished_at, last_played_at, play_time FROM user_games WHERE user_id = ?
      ON CONFLICT(user_id, game) DO UPDATE SET favorite_at = MAX(user_games.favorite_at, excluded.favorite_at), finished_at = MAX(user_games.finished_at, excluded.finished_at), last_played_at = MAX(user_games.last_played_at, excluded.last_played_at), play_time = MAX(user_games.play_time, excluded.play_time)`).run(to, from)
  }
  router(): Router {
    const r = Router({ caseSensitive: true, strict: true })
    r.get('/auth/providers', (_req, res) => res.json({ enabled: this.enabled, setup: this.enabled && this.unclaimed, local: this.cfg.authLocal }))
    r.post('/auth/setup/verify', (req, res) => {
      if (!this.enabled || !this.unclaimed) throw new HttpError(409, 'Setup is complete')
      if (this.attempts <= 0) throw new HttpError(429, 'Restart Renplay to get a new setup code')
      this.attempts--
      if (typeof req.body?.code !== 'string' || !equal(req.body.code, this.setupCode)) throw new HttpError(403, 'That setup code is wrong')
      this.setupGrant ||= random()
      res.json({ grant: this.setupGrant })
    })
    r.post('/auth/setup', async (req, res) => {
      if (!this.enabled || !this.setupGrant || typeof req.body?.grant !== 'string' || !equal(this.setupGrant, req.body.grant)) throw new HttpError(403, 'Enter the setup code first')
      await this.claim(req.body.username, req.body.name || req.body.username, req.body.password)
      this.newSession(req, res, 1)
      res.json({ ok: true })
    })
    r.post('/auth/login', async (req, res) => {
      if (!this.enabled || !this.cfg.authLocal) throw new HttpError(403, 'Local sign-in is off')
      this.limit(`ip:${req.ip}`)
      const login = typeof req.body?.username === 'string' ? req.body.username.toLowerCase().slice(0, 64) : ''
      this.limit(`user:${login}`)
      const row = this.db.raw.prepare("SELECT user_id, password FROM identities WHERE provider = 'local' AND subject = ?").get(login) as { user_id: number; password: string } | undefined
      const valid = await passwordMatches(req.body?.password, row?.password ?? this.dummyPassword)
      if (!valid || !row || this.user(row.user_id).disabled) throw new HttpError(401, 'The username or password is wrong')
      if (!row.password.startsWith(PASSWORD_PREFIX)) {
        const upgraded = await passwordHash(req.body.password)
        // A concurrent password reset must not be undone by this upgrade.
        const result = this.db.raw.prepare("UPDATE identities SET password = ? WHERE provider = 'local' AND subject = ? AND password = ?").run(upgraded, login, row.password)
        if (!result.changes) throw new HttpError(401, 'The username or password is wrong')
      } else if (this.db.raw.prepare("SELECT password FROM identities WHERE provider = 'local' AND subject = ?").get(login)?.password !== row.password) {
        throw new HttpError(401, 'The username or password is wrong')
      }
      if (this.user(row.user_id).disabled) throw new HttpError(401, 'The username or password is wrong')
      this.newSession(req, res, row.user_id)
      res.json({ ok: true })
    })
    r.post('/auth/logout', (req, res) => {
      if (viewer()?.session) this.db.raw.prepare('DELETE FROM sessions WHERE hash = ?').run(viewer()!.session)
      this.invalidate(); this.cookie(req, res, '')
      res.json({ ok: true })
    })
    r.get('/me', (_req, res) => res.json({ user: this.current(), auth: this.enabled, unclaimed: this.unclaimed }))
    r.put('/me', async (req, res) => {
      this.db.raw.prepare('UPDATE users SET name = ? WHERE id = ?').run(name(req.body?.name), this.current().id)
      await this.tag(this.user(this.current().id)); res.json({ ok: true })
    })
    r.post('/me/password', async (req, res) => {
      const u = this.current()
      const identity = this.db.raw.prepare("SELECT password FROM identities WHERE provider = 'local' AND user_id = ?").get(u.id) as { password: string } | undefined
      if (!identity || !await passwordMatches(req.body?.current, identity.password)) throw new HttpError(403, 'The current password is wrong')
      const encoded = await passwordHash(req.body?.password)
      this.db.raw.prepare("UPDATE identities SET password = ? WHERE provider = 'local' AND user_id = ?").run(encoded, u.id)
      this.revoke(u.id, viewer()!.session); res.json({ ok: true })
    })
    r.get('/me/prefs', (_req, res) => res.json(parseJson(this.current().prefs, {})))
    r.put('/me/prefs', (req, res) => {
      const mode = req.body?.adultPictures
      if (!['show', 'hide-pictures', 'hide-games'].includes(mode)) throw new HttpError(400, 'Choose Show, Hide pictures or Hide adult games')
      this.db.raw.prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify({ adultPictures: mode }), this.current().id)
      res.json({ adultPictures: mode })
    })
    r.get('/me/sessions', (_req, res) => res.json({ sessions: this.db.raw.prepare('SELECT hash AS id, created_at, touched_at, expires_at, label FROM sessions WHERE user_id = ? AND expires_at > ?').all(this.current().id, Date.now()).map((s) => ({ ...s, current: s.id === viewer()?.session })) }))
    r.delete('/me/sessions', (_req, res) => { this.revoke(this.current().id, viewer()!.session); res.json({ ok: true }) })
    r.delete('/me/sessions/:id', (req, res) => { this.db.raw.prepare('DELETE FROM sessions WHERE user_id = ? AND hash = ?').run(this.current().id, req.params.id); this.invalidate(); res.json({ ok: true }) })
    r.get('/me/tokens', (_req, res) => res.json({ tokens: this.db.raw.prepare('SELECT id, name, created_at FROM tokens WHERE user_id = ?').all(this.current().id) }))
    r.post('/me/tokens', (req, res) => {
      const token = random(), id = randomBytes(12).toString('hex')
      this.db.raw.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?, ?)').run(hash(token), id, this.current().id, name(req.body?.name), Date.now())
      res.json({ id, token })
    })
    r.delete('/me/tokens/:id', (req, res) => { this.db.raw.prepare('DELETE FROM tokens WHERE user_id = ? AND id = ?').run(this.current().id, req.params.id); res.json({ ok: true }) })
    r.get('/users', (_req, res) => res.json({ users: this.db.raw.prepare('SELECT * FROM users').all() }))
    r.post('/users', async (req, res) => {
      const login = username(req.body?.username), display = name(req.body?.name || login), encoded = await passwordHash(req.body?.password)
      if (this.db.raw.prepare('SELECT 1 FROM users WHERE username = ?').get(login)) throw new HttpError(409, 'That username is taken')
      const role = req.body?.role ?? 'player'
      if (!['admin', 'player'].includes(role)) throw new HttpError(400, 'Choose Admin or Player')
      this.db.raw.exec('BEGIN IMMEDIATE')
      let id: number
      try {
        id = Number(this.db.raw.prepare('INSERT INTO users (username, name, role, adult_access, created_at) VALUES (?, ?, ?, ?, ?)').run(login, display, role, req.body?.adultAccess === true || (req.body?.adultAccess === undefined && this.cfg.adultDefault) ? 1 : 0, new Date().toISOString()).lastInsertRowid)
        this.db.raw.prepare("INSERT INTO identities VALUES ('local', ?, ?, ?)").run(login, id, encoded)
        this.db.raw.exec('COMMIT')
      } catch (e) { this.db.raw.exec('ROLLBACK'); throw e }
      await this.tag(this.user(id)); res.status(201).json({ user: this.user(id) })
    })
    r.put('/users/:id', async (req, res) => {
      const target = this.user(Number(req.params.id)), b = req.body ?? {}
      if (this.removing.has(target.id)) throw new HttpError(409, 'This account is being archived')
      if (b.role !== undefined && !['admin', 'player'].includes(b.role)) throw new HttpError(400, 'Choose Admin or Player')
      for (const key of ['disabled', 'adultAccess']) if (b[key] !== undefined && typeof b[key] !== 'boolean') throw new HttpError(400, `${key} must be a boolean`)
      this.guardLastAdmin(target, b)
      this.db.raw.prepare('UPDATE users SET name = ?, role = ?, disabled = ?, adult_access = ? WHERE id = ?').run(b.name === undefined ? target.name : name(b.name), b.role ?? target.role, b.disabled === undefined ? target.disabled : Number(b.disabled), b.adultAccess === undefined ? target.adult_access : Number(b.adultAccess), target.id)
      this.invalidate(); await this.tag(this.user(target.id)); res.json({ user: this.user(target.id) })
    })
    r.post('/users/:id/password', async (req, res) => {
      const target = this.user(Number(req.params.id)), encoded = await passwordHash(req.body?.password)
      this.db.raw.prepare("UPDATE identities SET password = ? WHERE provider = 'local' AND user_id = ?").run(encoded, target.id)
      this.revoke(target.id); res.json({ ok: true })
    })
    r.post('/users/:id/saves/copy', async (req, res) => res.json({ copied: await this.copy(Number(req.params.id), Number(req.body?.target), req.body?.game) }))
    r.get('/users/:id/saves/export', async (req, res) => {
      const id = this.user(Number(req.params.id)).id, store = this.store(id)
      res.attachment(`renplay-user-${id}-saves.zip`).type('application/zip')
      await store.exportZip(await store.listDirs(), res, { includeTokens: true })
    })
    r.post('/users/:id/saves/import', saveImport('file', async (req, res) => {
      const target = this.store(this.user(Number(req.params.id)).id)
      if (!req.file) throw new HttpError(400, 'Upload a save folder zip')
      const entries = await readZipEntries(req.file.path, () => true, 128 << 20)
      const files = [...entries].map(([path, data]) => {
        const rel = cleanRelPath(path), slash = rel.indexOf('/'), dir = rel.slice(0, slash)
        if (slash < 1 || !isSaveDirName(dir)) throw new HttpError(400, 'Zip entries must be inside save folders')
        return { dir, file: rel.slice(slash + 1), data }
      })
      for (const f of files) {
        if (f.dir === 'tokens' && f.file === 'security_keys.txt') await target.mergeSecurityKeys(f.data.toString('utf-8'))
        else await target.write(f.dir, f.file, f.data, { reason: 'user-import' })
      }
      res.json({ imported: files.length })
    }))
    const remove = async (id: number) => {
      const u = this.user(id)
      if (id === 1 || id === this.cfg.authUser) throw new HttpError(409, 'The no-sign-in account must stay')
      if (this.removing.has(id)) throw new HttpError(409, 'This account is being archived')
      this.guardLastAdmin(u, {}, true)
      const store = this.store(id), source = join(this.cfg.dataDir, 'users', String(id))
      const destination = join(this.cfg.dataDir, 'users-removed', `${id}-${Date.now()}`)
      this.removing.add(id)
      // Reserve the removal synchronously: two concurrent removals cannot both pass the last-admin check.
      this.db.raw.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(id)
      this.invalidate()
      try {
        await store.pauseWrites()
        await mkdir(join(this.cfg.dataDir, 'users-removed'), { recursive: true })
        await rename(source, destination)
        this.db.raw.exec('BEGIN IMMEDIATE')
        try {
          for (const table of ['sessions', 'tokens', 'identities', 'user_games']) this.db.raw.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id)
          this.db.raw.prepare('DELETE FROM users WHERE id = ?').run(id)
          this.db.raw.exec('COMMIT')
        } catch (error) {
          this.db.raw.exec('ROLLBACK')
          await rename(destination, source)
          throw error
        }
        this.invalidate(); this.stores.delete(id)
      } catch (error) {
        this.db.raw.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(u.disabled, id)
        store.resumeWrites()
        throw error
      } finally { this.removing.delete(id) }
    }
    r.post('/me/claim-owner', async (_req, res) => {
      const u = this.current(), session = viewer()!.session
      if (u.role !== 'admin') throw new HttpError(403, 'Only an admin can claim the owner account')
      if (!this.unclaimed) throw new HttpError(409, 'The owner account is already claimed')
      if (u.id === 1) throw new HttpError(409, 'Use the setup code to choose the owner password')
      if (u.id === this.cfg.authUser) throw new HttpError(409, 'Choose the owner as RENPLAY_AUTH_USER before claiming it')
      await this.copy(u.id, 1)
      this.mergeProgress(u.id, 1)
      this.db.raw.exec('BEGIN IMMEDIATE')
      try {
        this.db.raw.prepare('UPDATE users SET username = ? WHERE id = ?').run(`archived-${u.id}-${randomBytes(4).toString('hex')}`, u.id)
        this.db.raw.prepare('UPDATE users SET username = ?, name = ?, adult_access = 1 WHERE id = 1').run(u.username, u.name)
        this.db.raw.prepare('UPDATE identities SET user_id = 1 WHERE user_id = ?').run(u.id)
        this.db.raw.prepare('UPDATE sessions SET user_id = 1 WHERE hash = ?').run(session)
        this.db.raw.exec('COMMIT')
      } catch (e) { this.db.raw.exec('ROLLBACK'); throw e }
      await remove(u.id)
      await this.tag(this.user(1)); this.setupCode = ''; this.setupGrant = ''; this.invalidate()
      res.json({ ok: true })
    })
    r.post('/users/:id/merge', async (req, res) => {
      const id = Number(req.params.id), target = Number(req.body?.target)
      if (id === 1 || id === this.cfg.authUser) throw new HttpError(409, 'The no-sign-in account must stay')
      this.guardLastAdmin(this.user(id), {}, true)
      const copied = await this.copy(id, target)
      this.mergeProgress(id, target)
      await remove(id); res.json({ copied })
    })
    r.delete('/users/:id', async (req, res) => { await remove(Number(req.params.id)); res.json({ ok: true }) })
    r.post('/games/:id/safe', (req, res) => {
      const g = this.db.getGame(req.params.id)
      if (!g || g.recipe_id) throw new HttpError(409, 'Only games without a recipe can be marked safe')
      if (typeof req.body?.safe !== 'boolean') throw new HttpError(400, 'Safe must be a boolean')
      if (req.body.safe) this.db.raw.prepare('INSERT OR IGNORE INTO safe_games VALUES (?)').run(g.id)
      else this.db.raw.prepare('DELETE FROM safe_games WHERE game = ?').run(g.id)
      res.json({ ok: true })
    })
    return r
  }
}
