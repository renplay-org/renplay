import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import * as avatars from '../avatars.js'
import { signInFixture, mockOidc, site } from './sign-in-fixture.js'

let provider: Awaited<ReturnType<typeof mockOidc>>, app: Awaited<ReturnType<typeof signInFixture>>
beforeEach(async () => { provider = await mockOidc() })
afterEach(async () => { app?.cleanup(); await provider.close(); vi.restoreAllMocks() })
async function start(patch = {}) { app = await signInFixture({ oidcIssuer: provider.issuer, oidcClientId: 'renplay', publicUrl: 'http://localhost:8080', ...patch }); return request.agent(app.app) }
async function authorize(agent: ReturnType<typeof request.agent>) {
  const start = await agent.get('/api/auth/oidc/start').expect(302)
  const result = await fetch(start.headers.location, { redirect: 'manual' })
  return new URL(result.headers.get('location')!)
}
async function callback(agent: ReturnType<typeof request.agent>) { const url = await authorize(agent); return agent.get(url.pathname + url.search) }

describe('OIDC authorization code sign-in', () => {
  it('uses PKCE, state, nonce, discovery and verified tokens, claims owner without moving its saves, and updates group permissions', async () => {
    provider.setClaims({ groups: ['admins', 'adults'] })
    const agent = await start({ oidcAdminGroup: 'admins', oidcAdultGroup: 'adults' })
    await app.accounts.store(1).write('test', 'persistent', Buffer.from('owner save'))
    expect((await callback(agent)).status).toBe(302)
    expect(provider.authorize?.searchParams.get('code_challenge_method')).toBe('S256')
    expect(provider.authorize?.searchParams.get('scope')).toBe('openid profile email groups')
    expect(provider.tokenBody?.get('code_verifier')).toHaveLength(43)
    expect((await agent.get('/api/me')).body).toMatchObject({ user: { id: 1, role: 'admin', adult_access: 1 }, unclaimed: false })
    expect((await app.accounts.store(1).read('test', 'persistent')).toString()).toBe('owner save')
    const users = (await agent.get('/api/users')).body.users
    expect(users[0]).toMatchObject({ roleManaged: true, adultManaged: true })
    await agent.put('/api/users/1').set(site).send({ adultAccess: false }).expect(409)
    provider.setClaims({ groups: [] })
    expect((await callback(agent)).status).toBe(302)
    expect((await agent.get('/api/me')).body.user).toMatchObject({ id: 1, role: 'player', adult_access: 0 })
    await agent.get('/api/users').expect(403)
  })
  it.each([{ nonce: 'wrong' }, { iss: 'https://wrong.example' }, { aud: 'other-client' }, { exp: 1 }, { azp: 'other-client' }])('rejects invalid claims %j', async claims => {
    provider.setClaims(claims); const agent = await start()
    expect((await callback(agent)).status).toBe(401)
    expect(app.db.raw.prepare('SELECT COUNT(*) n FROM identities').get()!.n).toBe(0)
  })
  it.each(['client_secret_basic', 'client_secret_post'])('uses discovered client authentication: %s', async method => {
    await provider.close(); provider = await mockOidc([method])
    const agent = await start({ oidcClientSecret: 'client secret!' })
    expect((await callback(agent)).status).toBe(302)
    if (method === 'client_secret_basic') {
      expect(provider.tokenAuthorization).toBe('Basic ' + Buffer.from('renplay:client+secret%21').toString('base64'))
      expect(provider.tokenBody?.get('client_secret')).toBeNull()
    } else {
      expect(provider.tokenAuthorization).toBeUndefined()
      expect(provider.tokenBody?.get('client_secret')).toBe('client secret!')
    }
  })
  it('rejects missing, mismatched, unbound and replayed state', async () => {
    const agent = await start(), url = await authorize(agent)
    await agent.get('/api/auth/oidc/callback?code=test-code').expect(401)
    await agent.get('/api/auth/oidc/callback?code=test-code&state=wrong').expect(401)
    await request(app.app).get(url.pathname + url.search).expect(401)
    await agent.get(url.pathname + url.search).expect(401)
  })
  it.each([false, true])('only verified email grants admin (verified=%s)', async verified => {
    provider.setClaims({ email: 'owner@example.org', email_verified: verified })
    const agent = await start({ admins: ['owner@example.org'] })
    expect((await callback(agent)).status).toBe(302)
    expect((await agent.get('/api/me')).body.user).toMatchObject({ role: verified ? 'admin' : 'player', id: verified ? 1 : 2 })
  })
  it('lets an admin who signed in before ownership was claimed bring both save sets to the owner', async () => {
    const agent = await start({ oidcAdminGroup: 'admins', oidcAdultGroup: 'adults' })
    expect((await callback(agent)).status).toBe(302)
    const id = (await agent.get('/api/me')).body.user.id
    expect(id).toBe(2)
    await app.accounts.store(1).write('test', 'persistent', Buffer.from('owner save'))
    await app.accounts.store(id).write('test', '1-1.save', Buffer.from('personal save'))
    provider.setClaims({ groups: ['admins'] })
    expect((await callback(agent)).status).toBe(302)
    await agent.post('/api/me/claim-owner').set(site).send({}).expect(200)
    expect((await agent.get('/api/me')).body).toMatchObject({ user: { id: 1, adult_access: 0 }, unclaimed: false })
    expect((await app.accounts.store(1).read('test', 'persistent')).toString()).toBe('owner save')
    expect((await app.accounts.store(1).read('test', '1-1.save')).toString()).toBe('personal save')
  })
  it('honors auto-create off but permits explicit linking, rejects an identity belonging to someone else and keeps the last method', async () => {
    const agent = await start({ oidcAutoCreate: false, adminUsername: 'admin', adminPassword: 'local password' })
    expect((await callback(agent)).status).toBe(403)
    await agent.post('/api/auth/login').set(site).send({ username: 'admin', password: 'local password' }).expect(200)
    const linked = await agent.post('/api/me/identities/oidc').set(site).send({}).expect(200)
    const auth = await fetch(linked.body.url, { redirect: 'manual' }), url = new URL(auth.headers.get('location')!)
    await agent.get(url.pathname + url.search).expect(302)
    expect((await agent.get('/api/me/identities')).body.identities).toHaveLength(2)
    await agent.delete('/api/me/identities').set(site).send({ provider: 'local', subject: 'admin' }).expect(200)
    await agent.delete('/api/me/identities').set(site).send({ provider: app.accounts.providers.oidcProvider, subject: 'subject-1' }).expect(409)
    await agent.post('/api/auth/logout').set(site).send({}).expect(200)
    expect((await callback(agent)).status).toBe(302)
    expect((await agent.get('/api/me')).body.user.id).toBe(1)
  })
  it('unlinks explicitly, removes mapped grants rather than bypassing restrictions, and rejects someone else’s identity', async () => {
    provider.setClaims({ groups: ['admins', 'adults'] })
    const owner = await start({ adminUsername: 'admin', adminPassword: 'local password', oidcAdminGroup: 'admins', oidcAdultGroup: 'adults', adultDefault: true })
    await owner.post('/api/auth/login').set(site).send({ username: 'admin', password: 'local password' }).expect(200)
    await owner.post('/api/users').set(site).send({ username: 'player', password: 'player password' }).expect(201)
    const player = request.agent(app.app)
    await player.post('/api/auth/login').set(site).send({ username: 'player', password: 'player password' }).expect(200)
    const linked = await player.post('/api/me/identities/oidc').set(site).send({}).expect(200)
    const auth = await fetch(linked.body.url, { redirect: 'manual' }), url = new URL(auth.headers.get('location')!)
    await player.get(url.pathname + url.search).expect(302)
    const conflict = await owner.post('/api/me/identities/oidc').set(site).send({}).expect(200)
    const other = await fetch(conflict.body.url, { redirect: 'manual' }), otherUrl = new URL(other.headers.get('location')!)
    await owner.get(otherUrl.pathname + otherUrl.search).expect(409)
    await player.delete('/api/me/identities').set(site).send({ provider: app.accounts.providers.oidcProvider, subject: 'not-mine' }).expect(404)
    await player.delete('/api/me/identities').set(site).send({ provider: app.accounts.providers.oidcProvider, subject: 'subject-1' }).expect(200)
    expect((await player.get('/api/me')).body.user).toMatchObject({ role: 'player', adult_access: 0 })
    expect((await player.get('/api/me/identities')).body.identities).toHaveLength(1)
  })
  it('copies a provider picture locally without hotlinking, preserves an upload and tolerates invalid pictures', async () => {
    const photo = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'blue' } }).png().toBuffer()
    const fetchPicture = vi.spyOn(avatars, 'fetchAvatar').mockResolvedValue(photo)
    provider.setClaims({ picture: 'https://pictures.example.org/avatar.png' })
    const agent = await start()
    expect((await callback(agent)).status).toBe(302)
    expect(fetchPicture).toHaveBeenCalledWith('https://pictures.example.org/avatar.png')
    const first = (await agent.get('/api/me')).body.user.avatar
    expect(first).toMatch(/^[a-f0-9]{64}\.webp$/)
    const upload = await agent.post('/api/me/avatar').set(site).set('Content-Type', 'image/png').send(photo).expect(200)
    fetchPicture.mockRejectedValue(new Error('Invalid URL'))
    expect((await callback(agent)).status).toBe(302)
    expect((await agent.get('/api/me')).body.user.avatar).toBe(upload.body.avatar)
    expect(fetchPicture).toHaveBeenCalledTimes(1)
    provider.setClaims({ sub: 'subject-2', picture: 'http://private.example/a' })
    expect((await callback(agent)).status).toBe(302)
    expect((await agent.get('/api/me')).body.user.avatar).toBe('')
  })
  it('does not link after the initiating session signs out', async () => {
    const agent = await start({ adminUsername: 'admin', adminPassword: 'local password' })
    await agent.post('/api/auth/login').set(site).send({ username: 'admin', password: 'local password' })
    const linked = await agent.post('/api/me/identities/oidc').set(site).send({})
    const auth = await fetch(linked.body.url, { redirect: 'manual' }), url = new URL(auth.headers.get('location')!)
    await agent.post('/api/auth/logout').set(site).send({})
    await agent.get(url.pathname + url.search).expect(401)
    expect((await app.db.raw.prepare('SELECT COUNT(*) n FROM identities').get())!.n).toBe(1)
  })
  it('allows SSO-only setup but refuses no provider or no admin rule', async () => {
    const agent = await start({ authLocal: false, oidcAdminGroup: 'admins' })
    expect((await agent.get('/api/auth/providers')).body).toMatchObject({ local: false, setup: false, oidc: 'Single sign-on' })
    await agent.post('/api/auth/setup/verify').set(site).send({ code: 'x' }).expect(409)
    await expect(signInFixture({ authLocal: false })).rejects.toThrow('No sign-in provider')
    await expect(signInFixture({ authLocal: false, oidcIssuer: provider.issuer, oidcClientId: 'renplay', publicUrl: 'http://localhost:8080' })).rejects.toThrow('admin group')
  })
})
