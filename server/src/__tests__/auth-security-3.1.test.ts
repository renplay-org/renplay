import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signInFixture, site } from './sign-in-fixture.js'
import type { ExternalIdentity } from '../sign-in-providers.js'

let app: Awaited<ReturnType<typeof signInFixture>>
afterEach(() => { vi.restoreAllMocks(); app?.cleanup() })
const credentials = { username: 'admin', password: 'local password' }
async function start() {
  app = await signInFixture({ adminUsername: credentials.username, adminPassword: credentials.password })
  const agent = request.agent(app.app)
  await agent.post('/api/auth/login').set(site).send(credentials).expect(200)
  return agent
}
function directory(): ExternalIdentity {
  app.cfg.ldapUrl = 'ldap://directory'; app.cfg.ldapBaseDn = 'dc=test'
  return { provider: app.accounts.providers.ldapProvider, subject: 'uuid-alex', username: 'alex', name: 'Alex', admin: false, roleManaged: false, adultManaged: false }
}
function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
async function player(owner: ReturnType<typeof request.agent>, login = 'alex', role = 'player') {
  await owner.post('/api/users').set(site).send({ username: login, password: 'local password', role }).expect(201)
  const agent = request.agent(app.app)
  await agent.post('/api/auth/login').set(site).send({ username: login, password: 'local password' }).expect(200)
  return agent
}

describe('LDAP linking live authorization', () => {
  it.each(['revoked session', 'expired session', 'disabled user', 'different user', 'revoked token'])('rejects %s during directory authentication', async change => {
    const agent = await start(), identity = directory(), entered = deferred(), finish = deferred()
    vi.spyOn(app.accounts.providers, 'ldap').mockImplementation(async () => { entered.release(); await finish.promise; return identity })
    let token = ''
    if (change === 'revoked token') token = (await agent.post('/api/me/tokens').set(site).send({ name: 'Link' })).body.token
    const pending = (token ? request(app.app).post('/api/me/identities/ldap').auth(token, { type: 'bearer' }) : agent.post('/api/me/identities/ldap').set(site)).send({ username: 'alex', password: 'directory password' }).then(r => r)
    await entered.promise
    if (change === 'revoked session') app.db.raw.exec('DELETE FROM sessions')
    if (change === 'expired session') app.db.raw.exec('UPDATE sessions SET expires_at = 0')
    if (change === 'disabled user') app.db.raw.exec('UPDATE users SET disabled = 1 WHERE id = 1')
    if (change === 'different user') app.db.raw.exec("INSERT INTO users (id, username, name, role, created_at) VALUES (999, 'other', 'Other', 'player', ''); UPDATE sessions SET user_id = 999")
    if (change === 'revoked token') app.db.raw.exec('DELETE FROM tokens')
    finish.release()
    expect((await pending).status).toBe(401)
    expect(app.db.raw.prepare("SELECT COUNT(*) n FROM identities WHERE provider != 'local'").get()!.n).toBe(0)
  })
})

describe('admin grant provenance', () => {
  it('recomputes an allowlist grant at sign-in and removes it on unlink', async () => {
    const owner = await start(), agent = await player(owner), identity = directory()
    identity.admin = true
    vi.spyOn(app.accounts.providers, 'ldap').mockResolvedValue(identity)
    await agent.post('/api/me/identities/ldap').set(site).send({}).expect(200)
    expect((await agent.get('/api/me')).body.user.role).toBe('admin')
    const source = (await owner.get('/api/users')).body.users.find((u: { username: string }) => u.username === 'alex').admin_source
    identity.admin = false
    await agent.post('/api/auth/login').set(site).send({ username: 'directory-alex', password: 'directory password' }).expect(200)
    expect((await agent.get('/api/me')).body.user.role).toBe('player')
    identity.admin = true
    await agent.post('/api/auth/login').set(site).send({ username: 'directory-alex', password: 'directory password' }).expect(200)
    await agent.delete('/api/me/identities').set(site).send({ provider: identity.provider, subject: identity.subject }).expect(200)
    expect((await agent.get('/api/me')).body.user.role).toBe('player')
    expect(source).toBe('allowlist')
  })
  it('removes an allowlist admin grant when its identity is unlinked', async () => {
    const owner = await start(), agent = await player(owner), identity = directory()
    identity.admin = true
    vi.spyOn(app.accounts.providers, 'ldap').mockResolvedValue(identity)
    await agent.post('/api/me/identities/ldap').set(site).send({}).expect(200)
    await agent.delete('/api/me/identities').set(site).send({ provider: identity.provider, subject: identity.subject }).expect(200)
    expect((await agent.get('/api/me')).body.user.role).toBe('player')
  })
  it('preserves an admin assignment made in Users across provider sign-in and unlink', async () => {
    const owner = await start(), agent = await player(owner), identity = directory()
    const id = (await agent.get('/api/me')).body.user.id
    await owner.put(`/api/users/${id}`).set(site).send({ role: 'admin' }).expect(200)
    vi.spyOn(app.accounts.providers, 'ldap').mockResolvedValue(identity)
    await agent.post('/api/me/identities/ldap').set(site).send({}).expect(200)
    identity.roleManaged = true; app.cfg.ldapAdminFilter = '(memberOf=admins)'
    await agent.post('/api/auth/login').set(site).send({ username: 'directory-alex', password: 'directory password' }).expect(200)
    expect((await agent.get('/api/me')).body.user).toMatchObject({ role: 'admin', admin_source: 'manual' })
    await agent.delete('/api/me/identities').set(site).send({ provider: identity.provider, subject: identity.subject }).expect(200)
    expect((await agent.get('/api/me')).body.user.role).toBe('admin')
  })
})

describe('LDAP with local authentication off', () => {
  it('permits a reserved username only for an explicitly linked directory identity', async () => {
    const owner = await start(), agent = await player(owner), identity = directory()
    const ldap = vi.spyOn(app.accounts.providers, 'ldap').mockResolvedValue(identity)
    app.cfg.authLocal = false
    await agent.post('/api/auth/login').set(site).send({ username: 'alex', password: 'directory password' }).expect(401)
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM identities').get()!.n).toBe(2)
    app.cfg.authLocal = true
    await agent.post('/api/me/identities/ldap').set(site).send({}).expect(200)
    app.cfg.authLocal = false
    await agent.post('/api/auth/login').set(site).send({ username: 'alex', password: 'directory password' }).expect(200)
    expect(ldap).toHaveBeenCalled()
    await agent.delete('/api/me/identities').set(site).send({ provider: identity.provider, subject: identity.subject }).expect(409)
    await agent.delete('/api/me/identities').set(site).send({ provider: 'local', subject: 'alex' }).expect(200)
  })
  it('does not count an LDAP username reserved by another account as reachable', async () => {
    const owner = await start(), agent = await player(owner, 'other'), identity = directory()
    await player(owner)
    vi.spyOn(app.accounts.providers, 'ldap').mockResolvedValue(identity)
    await agent.post('/api/me/identities/ldap').set(site).send({}).expect(200)
    await agent.delete('/api/me/identities').set(site).send({ provider: 'local', subject: 'other' }).expect(409)
  })
})

describe('atomic owner claiming', () => {
  it('rejects a competing claim before it can copy saves', async () => {
    app = await signInFixture()
    // Seed two existing admins without claiming the owner.
    for (const login of ['first', 'second']) {
      const id = Number(app.db.raw.prepare("INSERT INTO users (username, name, role, created_at) VALUES (?, ?, 'admin', '')").run(login, login).lastInsertRowid)
      app.db.raw.prepare("INSERT INTO identities VALUES ('local', ?, ?, '')").run(login, id)
      app.db.raw.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?, ?)').run((await import('node:crypto')).createHash('sha256').update(login).digest('hex'), login, id, login, Date.now())
      await app.services.saveStores.of(id).write('test', `${login}.save`, Buffer.from(login))
    }
    const entered = deferred(), finish = deferred(), source = app.services.saveStores.of(2), list = source.listDirs.bind(source)
    vi.spyOn(source, 'listDirs').mockImplementation(async () => { entered.release(); await finish.promise; return list() })
    const loserCopy = vi.spyOn(app.services.saveStores.of(3), 'listDirs')
    const first = request(app.app).post('/api/me/claim-owner').auth('first', { type: 'bearer' }).send({}).then(r => r)
    await entered.promise
    const second = await request(app.app).post('/api/me/claim-owner').auth('second', { type: 'bearer' }).send({})
    finish.release()
    expect((await first).status).toBe(200)
    expect(second.status).toBe(409)
    expect(loserCopy).not.toHaveBeenCalled()
    expect((await app.services.saveStores.of(1).list('test')).map(f => f.name)).toEqual(['first.save'])
    expect(app.db.raw.prepare('SELECT user_id FROM identities WHERE subject = ?').get('second')!.user_id).toBe(3)
  })
  it('does not restore admin rights removed while the claim was copying saves', async () => {
    app = await signInFixture()
    const id = Number(app.db.raw.prepare("INSERT INTO users (username, name, role, created_at) VALUES ('claimant', 'Claimant', 'admin', '')").run().lastInsertRowid)
    app.db.raw.prepare("INSERT INTO identities VALUES ('local', 'claimant', ?, '')").run(id)
    app.db.raw.prepare('INSERT INTO tokens VALUES (?, ?, ?, ?, ?)').run((await import('node:crypto')).createHash('sha256').update('claimant').digest('hex'), 'claimant', id, 'claimant', Date.now())
    await app.services.saveStores.of(id).write('test', 'claimant.save', Buffer.from('claimant'))
    const entered = deferred(), finish = deferred(), source = app.services.saveStores.of(id), list = source.listDirs.bind(source)
    vi.spyOn(source, 'listDirs').mockImplementation(async () => { entered.release(); await finish.promise; return list() })
    const claim = request(app.app).post('/api/me/claim-owner').auth('claimant', { type: 'bearer' }).send({}).then(r => r)
    await entered.promise
    // The identity provider takes the admin role away while the saves are being copied.
    app.db.raw.prepare("UPDATE users SET role = 'player' WHERE id = ?").run(id)
    finish.release()
    expect((await claim).status).toBe(403)
    expect(app.accounts.unclaimed).toBe(true)
    expect(app.db.raw.prepare('SELECT user_id FROM identities WHERE subject = ?').get('claimant')!.user_id).toBe(id)
    expect(app.db.raw.prepare('SELECT role FROM users WHERE id = ?').get(id)!.role).toBe('player')
  })
  it('recovers a reservation left by an interrupted process on startup', async () => {
    app = await signInFixture()
    app.db.setSetting('owner_claim', 'interrupted')
    expect(app.accounts.unclaimed).toBe(false)
    await app.accounts.init()
    expect(app.accounts.unclaimed).toBe(true)
  })
  it('releases a failed reservation so a retry can finish', async () => {
    const owner = await start(), agent = await player(owner, 'claimant', 'admin')
    app.db.raw.exec('DELETE FROM identities WHERE user_id = 1')
    const id = (await agent.get('/api/me')).body.user.id
    const target = app.services.saveStores.of(1), source = app.services.saveStores.of(id)
    for (const file of ['one.save', 'two.save']) {
      await source.write('test', file, Buffer.from('personal save'))
      await target.write('test', file, Buffer.from('owner save'))
    }
    const write = target.write.bind(target)
    vi.spyOn(target, 'write').mockImplementationOnce(write).mockRejectedValueOnce(new Error('Copy failed partway'))
    await agent.post('/api/me/claim-owner').set(site).send({}).expect(500)
    expect(app.accounts.unclaimed).toBe(true)
    expect(await target.history('test')).toHaveLength(1)
    await agent.post('/api/me/claim-owner').set(site).send({}).expect(200)
    for (const file of ['one.save', 'two.save']) expect((await target.read('test', file)).toString()).toBe('personal save')
    expect(await target.history('test')).toHaveLength(2)
  })
})
