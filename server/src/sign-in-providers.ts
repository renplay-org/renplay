import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { readFileSync } from 'node:fs'
import { Client } from 'ldapts'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Config } from './config.js'
import { HttpError } from './util/paths.js'

export interface ExternalIdentity {
  provider: string; subject: string; username: string; name: string
  admin: boolean; adult?: boolean; roleManaged: boolean; adultManaged: boolean
  picture?: string | Buffer
}
const text = (v: unknown) => typeof v === 'string' ? v : ''
const formEncode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2)
export const escapeLdapFilter = (s: string) => s.replace(/[\\*()\x00]/g, c => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
const filter = (s: string) => s.startsWith('(') ? s : `(${s})`
function endpoint(value: string): URL {
  const u = new URL(value)
  if (u.username || u.password || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)))) throw new Error('OIDC requires HTTPS (HTTP is allowed only on loopback for testing)')
  return u
}
export class SignInProviders {
  private discovery?: { authorization_endpoint: string; token_endpoint: string; jwks_uri: string; token_endpoint_auth_methods_supported?: string[] }
  private jwks?: ReturnType<typeof createRemoteJWKSet>
  constructor(readonly cfg: Config) {}
  get oidcProvider() { return `oidc:${this.cfg.oidcIssuer}` }
  get ldapProvider() { return `ldap:${this.cfg.ldapUrl}/${this.cfg.ldapBaseDn}` }
  async init() {
    const c = this.cfg
    if (c.oidcIssuer) {
      if (!c.oidcClientId || !c.publicUrl) throw new Error('OIDC needs RENPLAY_OIDC_CLIENT_ID and RENPLAY_PUBLIC_URL')
      endpoint(c.publicUrl)
      const response = await fetch(endpoint(c.oidcIssuer.replace(/\/$/, '') + '/.well-known/openid-configuration'), { signal: AbortSignal.timeout(10000), redirect: 'error' })
      if (!response.ok) throw new Error('OIDC discovery failed')
      const d = await response.json() as Record<string, unknown>
      if (d.issuer !== c.oidcIssuer) throw new Error('OIDC discovery issuer does not match')
      for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) endpoint(text(d[key]))
      const methods = Array.isArray(d.token_endpoint_auth_methods_supported) ? d.token_endpoint_auth_methods_supported : ['client_secret_basic']
      if (c.oidcClientSecret && !methods.some(m => m === 'client_secret_basic' || m === 'client_secret_post')) throw new Error('OIDC must support client_secret_basic or client_secret_post')
      this.discovery = d as unknown as typeof this.discovery
      this.jwks = createRemoteJWKSet(endpoint(text(d.jwks_uri)), { timeoutDuration: 10000 })
    }
    if (c.ldapUrl) {
      const directory = new URL(c.ldapUrl)
      if (!['ldap:', 'ldaps:'].includes(directory.protocol) || directory.username || directory.password || !c.ldapBaseDn || !c.ldapBindDn || !c.ldapBindPassword) throw new Error('LDAP needs a valid URL, base DN and bind credentials')
      const client = await this.ldapClient()
      try { await client.bind(c.ldapBindDn, c.ldapBindPassword) } finally { await client.unbind() }
    }
  }
  get callback() { return new URL('/api/auth/oidc/callback', this.cfg.publicUrl).href }
  authorization(state: string, nonce: string, verifier: string): string {
    if (!this.discovery) throw new HttpError(503, 'Single sign-on is unavailable')
    const u = new URL(this.discovery.authorization_endpoint)
    u.search = new URLSearchParams({ client_id: this.cfg.oidcClientId, redirect_uri: this.callback, response_type: 'code', scope: 'openid profile email groups', state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString()
    return u.href
  }
  async oidc(code: string, nonce: string, verifier: string): Promise<ExternalIdentity> {
    if (!this.discovery || !this.jwks) throw new HttpError(503, 'Single sign-on is unavailable')
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.callback, client_id: this.cfg.oidcClientId, code_verifier: verifier })
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
    if (this.cfg.oidcClientSecret) {
      const methods = this.discovery.token_endpoint_auth_methods_supported ?? ['client_secret_basic']
      if (methods.includes('client_secret_basic')) headers.authorization = 'Basic ' + Buffer.from(`${formEncode(this.cfg.oidcClientId)}:${formEncode(this.cfg.oidcClientSecret)}`).toString('base64')
      else body.set('client_secret', this.cfg.oidcClientSecret)
    }
    const response = await fetch(this.discovery.token_endpoint, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new HttpError(401, 'Single sign-on failed')
    const tokens = await response.json() as { id_token?: string }
    if (!tokens.id_token) throw new HttpError(401, 'No identity token was returned')
    const { payload: p } = await jwtVerify(tokens.id_token, this.jwks, { issuer: this.cfg.oidcIssuer, audience: this.cfg.oidcClientId, algorithms: ['RS256', 'ES256'], requiredClaims: ['exp', 'iat', 'sub', 'nonce'] })
    if (p.nonce !== nonce || !p.sub || (Array.isArray(p.aud) && p.aud.length > 1 && p.azp !== this.cfg.oidcClientId) || (p.azp !== undefined && p.azp !== this.cfg.oidcClientId)) throw new HttpError(401, 'The sign-in response does not match this request')
    const groups: string[] = Array.isArray(p.groups) && p.groups.every(s => typeof s === 'string') ? p.groups : []
    const login = text(p.preferred_username) || p.sub
    const admin = this.cfg.oidcAdminGroup ? groups.includes(this.cfg.oidcAdminGroup) : this.isAdmin(login, text(p.email), p.email_verified === true)
    return { provider: this.oidcProvider, subject: p.sub, username: login, name: text(p.name) || login, admin, adult: this.cfg.oidcAdultGroup ? groups.includes(this.cfg.oidcAdultGroup) : undefined, roleManaged: !!this.cfg.oidcAdminGroup, adultManaged: !!this.cfg.oidcAdultGroup, picture: text(p.picture) || undefined }
  }
  private isAdmin(username: string, email: string, verified: boolean) {
    return this.cfg.admins.some(a => a.includes('@') ? verified && a === email.toLowerCase() : a === username.toLowerCase())
  }
  private async ldapClient() {
    const tlsOptions = { rejectUnauthorized: true, ...(this.cfg.ldapCaFile ? { ca: readFileSync(this.cfg.ldapCaFile) } : {}) }
    const client = new Client({ url: this.cfg.ldapUrl, timeout: 10000, connectTimeout: 10000, ...(this.cfg.ldapUrl.startsWith('ldaps:') ? { tlsOptions } : {}) })
    if (this.cfg.ldapStartTls && !this.cfg.ldapUrl.startsWith('ldaps:')) {
      try { await client.startTLS(tlsOptions) } catch (error) { await client.unbind().catch(() => {}); throw error }
    }
    return client
  }
  async ldap(username: unknown, password: unknown): Promise<ExternalIdentity> {
    if (typeof username !== 'string' || !username || username.length > 256 || typeof password !== 'string' || !password || password.length > 1024) throw new HttpError(401, 'The username or password is wrong')
    const started = performance.now()
    const c = this.cfg, client = await this.ldapClient()
    try {
      await client.bind(c.ldapBindDn, c.ldapBindPassword)
      const { searchEntries } = await client.search(c.ldapBaseDn, { scope: 'sub', filter: c.ldapUserFilter.replaceAll('{username}', escapeLdapFilter(username)), sizeLimit: 2, attributes: [c.ldapUsernameAttribute, c.ldapNameAttribute, 'cn', c.ldapEmailAttribute, c.ldapPhotoAttribute, 'entryUUID'], explicitBufferAttributes: [c.ldapPhotoAttribute] })
      if (searchEntries.length !== 1) {
        // Local dummy verification avoids another bind that could lock a directory account.
        await new Promise<void>((resolve, reject) => scrypt(password, 'Renplay LDAP dummy verification', 64, { N: 32768, r: 8, p: 1, maxmem: 64 << 20 }, (error, key) => {
          if (error) reject(error)
          else { timingSafeEqual(key, Buffer.alloc(64)); resolve() }
        }))
        throw new Error('User not found')
      }
      const entry = searchEntries[0]!
      await client.bind(entry.dn, password)
      // Group checks use the service account, not the user's directory permissions.
      await client.bind(c.ldapBindDn, c.ldapBindPassword)
      const matches = async (f: string) => {
        try { return !!(await client.search(entry.dn, { scope: 'base', filter: filter(f), attributes: ['dn'], sizeLimit: 1 })).searchEntries.length }
        catch (error) {
          // LLDAP reports NoSuchObject for a base search whose filter does not match.
          if ((error as { code?: number }).code === 32) return false
          throw error
        }
      }
      const attr = (key: string) => { const v = entry[key]; return Array.isArray(v) ? v[0] : v }
      const login = text(attr(c.ldapUsernameAttribute)) || username
      return { provider: this.ldapProvider, subject: text(attr('entryUUID')) || entry.dn, username: login, name: text(attr(c.ldapNameAttribute)) || text(attr('cn')) || login, admin: c.ldapAdminFilter ? await matches(c.ldapAdminFilter) : this.isAdmin(login, '', false), adult: c.ldapAdultFilter ? await matches(c.ldapAdultFilter) : undefined, roleManaged: !!c.ldapAdminFilter, adultManaged: !!c.ldapAdultFilter, picture: Buffer.isBuffer(attr(c.ldapPhotoAttribute)) ? attr(c.ldapPhotoAttribute) as Buffer : undefined }
    } catch {
      // Pad both failure paths beyond normal directory verification time.
      await delay(Math.max(0, 500 - (performance.now() - started)))
      throw new HttpError(401, 'The username or password is wrong')
    } finally { await client.unbind().catch(() => {}) }
  }
}
export const signInRandom = () => randomBytes(32).toString('base64url')
