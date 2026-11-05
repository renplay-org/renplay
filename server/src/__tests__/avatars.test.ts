import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchAvatar, publicAvatarAddress, storeAvatar } from '../avatars.js'
import { signInFixture, site } from './sign-in-fixture.js'

let app: Awaited<ReturnType<typeof signInFixture>>
afterEach(() => app?.cleanup())
describe('account avatars', () => {
  it('crops and stores content-addressed 256 px WebP, authenticates reads and gives uploaded pictures precedence', async () => {
    app = await signInFixture({ adminUsername: 'admin', adminPassword: 'local password' })
    const agent = request.agent(app.app)
    await agent.post('/api/auth/login').set(site).send({ username: 'admin', password: 'local password' })
    const photo = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#f4508a' } }).png().toBuffer()
    const first = await agent.post('/api/me/avatar').set(site).set('Content-Type', 'image/png').send(photo).expect(200)
    expect(first.body.avatar).toMatch(/^[a-f0-9]{64}\.webp$/)
    expect((await sharp(await readFile(join(app.cfg.dataDir, 'avatars', first.body.avatar))).metadata())).toMatchObject({ width: 256, height: 256, format: 'webp' })
    const second = await agent.post('/api/me/avatar').set(site).set('Content-Type', 'image/png').send(photo).expect(200)
    expect(first.body).toEqual(second.body)
    expect((await agent.get('/api/me')).body.user).toMatchObject({ avatar: first.body.avatar, avatar_uploaded: 1 })
    await request(app.app).get(`/api/avatars/${first.body.avatar}`).expect(401)
    const response = await agent.get(`/api/avatars/${first.body.avatar}`).expect(200)
    expect(response.headers['cache-control']).toContain('no-store')
    await agent.get('/api/avatars/not-an-avatar').expect(404)
    await agent.post('/api/me/avatar').set(site).send({ image: 'no' }).expect(400)
    await agent.post('/api/me/avatar').set(site).set('Content-Type', 'image/png').send(Buffer.from('bad image')).expect(400)
    await agent.post('/api/me/avatar').set(site).set('Content-Type', 'image/png').send(Buffer.alloc((2 << 20) + 1)).expect(413)
  })
  it('refuses oversized, non-image, SVG and decompression-bomb sources', async () => {
    app = await signInFixture()
    await expect(storeAvatar(app.cfg.dataDir, Buffer.alloc((2 << 20) + 1))).rejects.toThrow('2 MiB')
    await expect(storeAvatar(app.cfg.dataDir, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"/>'))).rejects.toThrow('JPEG')
    const large = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: 'white' } }).png().toBuffer()
    await expect(storeAvatar(app.cfg.dataDir, large)).rejects.toThrow('16 megapixels')
  })
  it('only fetches HTTPS and refuses private hosts, credentials, arbitrary ports and IPv4-mapped IPv6', async () => {
    for (const url of ['http://example.org/image.jpg', 'file:///etc/passwd', 'https://user:password@example.org/a', 'https://example.org:8443/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://localhost/a']) await expect(fetchAvatar(url)).rejects.toThrow()
    for (const ip of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) expect(publicAvatarAddress(ip)).toBe(false)
    expect(publicAvatarAddress('8.8.8.8')).toBe(true)
    expect(publicAvatarAddress('2606:4700::1111')).toBe(true)
  })
})
