import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createApp } from '../app.js'
import { loadConfig, type Config } from '../config.js'

export const site = { 'Sec-Fetch-Site': 'same-origin' }
export async function signInFixture(patch: Partial<Config> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'renplay-sign-in-')), dataDir = join(root, 'data'), gamesDir = join(root, 'games'), internalDir = join(gamesDir, '_renplay')
  const cfg: Config = { ...loadConfig(), dataDir, gamesDir, internalDir, savesDir: join(dataDir, 'saves'), saveHistoryDir: join(dataDir, 'save-history'), coversDir: join(dataDir, 'covers'), walkthroughsDir: join(dataDir, 'walkthroughs'), overlaysDir: join(dataDir, 'overlays'), workDir: join(internalDir, 'work'), purgeDir: join(internalDir, 'purge'), archivesDir: join(gamesDir, '_archives'), uploadsDir: join(internalDir, 'uploads'), enginesDir: join(internalDir, 'engines'), catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', auth: 'on', authLocal: true, authUser: 1, adultGames: 'shown', adminUsername: '', adminPassword: '', adultDefault: 'off', ...patch }
  let cleaned = false
  try { const app = await createApp(cfg, { startJobs: false }); return { ...app, cfg, cleanup: () => { if (cleaned) return; cleaned = true; app.close(); rmSync(root, { recursive: true, force: true }) } } } catch (e) { rmSync(root, { recursive: true, force: true }); throw e }
}
export async function mockOidc(authMethods = ['client_secret_basic']) {
  const { privateKey, publicKey } = await generateKeyPair('RS256'), jwk = { ...await exportJWK(publicKey), kid: 'test', alg: 'RS256' }
  let issuer = '', authorize: URL | undefined, tokenBody: URLSearchParams | undefined
  let claims: Record<string, unknown> = {}, nonce = '', tokenAuthorization: string | undefined
  let signing = { algorithm: 'RS256', invalidSignature: false }
  const otherKey = await generateKeyPair('RS256')
  const server = createServer(async (req, res) => {
    const u = new URL(req.url!, issuer)
    res.setHeader('Content-Type', 'application/json')
    if (u.pathname === '/.well-known/openid-configuration') res.end(JSON.stringify({ issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks', token_endpoint_auth_methods_supported: authMethods }))
    else if (u.pathname === '/jwks') res.end(JSON.stringify({ keys: [jwk] }))
    else if (u.pathname === '/authorize') {
      authorize = u; nonce = u.searchParams.get('nonce')!
      res.statusCode = 302; const callback = new URL(u.searchParams.get('redirect_uri')!); callback.search = new URLSearchParams({ state: u.searchParams.get('state')!, code: 'test-code' }).toString(); res.setHeader('Location', callback.href); res.end()
    } else if (u.pathname === '/token') {
      let body = ''; for await (const chunk of req) body += chunk
      tokenBody = new URLSearchParams(body)
      tokenAuthorization = req.headers.authorization
      const { createHash } = await import('node:crypto')
      const challenge = createHash('sha256').update(tokenBody.get('code_verifier') || '').digest('base64url')
      if (challenge !== authorize?.searchParams.get('code_challenge') || tokenBody.get('code') !== 'test-code') { res.statusCode = 400; res.end('{}'); return }
      const key = signing.algorithm === 'HS256' ? new TextEncoder().encode('test symmetric key with enough bytes') : signing.invalidSignature ? otherKey.privateKey : privateKey
      const id_token = await new SignJWT({ sub: 'subject-1', preferred_username: 'alex', name: 'Alex Reader', nonce, ...claims }).setProtectedHeader({ alg: signing.algorithm, kid: 'test' }).setIssuer(typeof claims.iss === 'string' ? claims.iss : issuer).setAudience(Array.isArray(claims.aud) ? claims.aud as string[] : typeof claims.aud === 'string' ? claims.aud : 'renplay').setIssuedAt().setExpirationTime(typeof claims.exp === 'number' ? claims.exp : '5m').sign(key)
      res.end(JSON.stringify({ id_token }))
    } else { res.statusCode = 404; res.end('{}') }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  return { get issuer() { return issuer }, get authorize() { return authorize }, get tokenBody() { return tokenBody }, get tokenAuthorization() { return tokenAuthorization }, setClaims: (c: Record<string, unknown>) => { claims = c }, setSigning: (algorithm: string, invalidSignature = false) => { signing = { algorithm, invalidSignature } }, close: () => new Promise<void>(r => server.close(() => r())) }
}
