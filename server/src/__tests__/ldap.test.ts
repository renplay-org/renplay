import { execFileSync } from 'node:child_process'
import request from 'supertest'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { escapeLdapFilter } from '../sign-in-providers.js'
import { signInFixture, site } from './sign-in-fixture.js'

it('escapes every LDAP filter metacharacter', () => { expect(escapeLdapFilter('a*)(uid=*)\\\0')).toBe('a\\2a\\29\\28uid=\\2a\\29\\5c\\00') })

// Run with RENPLAY_TEST_LLDAP=renplay-31-lldap and the disposable fixture from scripts/test-ldap.sh.
describe.skipIf(!process.env.RENPLAY_TEST_LLDAP)('LDAP against real LLDAP', () => {
  let token = '', app: Awaited<ReturnType<typeof signInFixture>>, adminGroup = 0, adultGroup = 0
  const base = 'http://127.0.0.1:17170', password = 'directory password'
  async function gql(query: string) {
    const res = await fetch(base + '/api/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ query }) })
    const result = await res.json() as { data: Record<string, any>; errors?: unknown }
    if (result.errors) throw new Error(JSON.stringify(result.errors)); return result.data
  }
  beforeAll(async () => {
    token = (await (await fetch(base + '/auth/simple/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }) })).json() as { token: string }).token
    for (const id of ['reader', 'both']) {
      await gql(`mutation { createUser(user: { id: "${id}", email: "${id}@example.org", displayName: "Directory ${id}" }) { id } }`)
      execFileSync('docker', ['exec', '-e', `LLDAP_USER_PASSWORD=${password}`, process.env.RENPLAY_TEST_LLDAP!, '/app/lldap_set_password', '--base-url', 'http://localhost:17170', '--token', token, '--username', id], { stdio: 'pipe' })
    }
    const photo = (await sharp({ create: { width: 100, height: 60, channels: 3, background: 'green' } }).jpeg().toBuffer()).toString('base64')
    await gql(`mutation { updateUser(user: { id: "reader", avatar: "${photo}" }) { ok } }`)
    adminGroup = (await gql('mutation { createGroup(name: "renplay-admins") { id } }')).createGroup.id
    adultGroup = (await gql('mutation { createGroup(name: "renplay-adults") { id } }')).createGroup.id
    await gql(`mutation { addUserToGroup(userId: "reader", groupId: ${adminGroup}) { ok } }`)
    await gql(`mutation { addUserToGroup(userId: "reader", groupId: ${adultGroup}) { ok } }`)
    app = await signInFixture({ ldapUrl: 'ldap://127.0.0.1:13890', ldapBindDn: 'uid=admin,ou=people,dc=example,dc=org', ldapBindPassword: password, ldapBaseDn: 'dc=example,dc=org', ldapAdminFilter: 'memberOf=cn=renplay-admins,ou=groups,dc=example,dc=org', ldapAdultFilter: 'memberOf=cn=renplay-adults,ou=groups,dc=example,dc=org' })
  }, 30000)
  afterAll(async () => {
    app?.cleanup()
    for (const id of ['reader', 'both']) await gql(`mutation { deleteUser(userId: "${id}") { ok } }`)
    for (const id of [adminGroup, adultGroup]) if (id) await gql(`mutation { deleteGroup(groupId: ${id}) { ok } }`)
  })
  it('authenticates, claims owner, maps filters, and removes mapped permissions on subsequent sign-in', async () => {
    const agent = request.agent(app.app)
    await agent.post('/api/auth/login').set(site).send({ username: 'reader', password: 'wrong' }).expect(401)
    await agent.post('/api/auth/login').set(site).send({ username: '*)(uid=*)', password }).expect(401)
    await agent.post('/api/auth/login').set(site).send({ username: 'reader', password }).expect(200)
    expect((await agent.get('/api/me')).body.user).toMatchObject({ id: 1, name: 'Directory reader', role: 'admin', adult_access: 1 })
    expect((await agent.get('/api/me')).body.user.avatar).toMatch(/^[a-f0-9]{64}\.webp$/)
    await agent.post('/api/users').set(site).send({ username: 'both', password: 'local password' }).expect(201)
    const local = request.agent(app.app)
    await local.post('/api/auth/login').set(site).send({ username: 'both', password }).expect(401)
    await local.post('/api/auth/login').set(site).send({ username: 'both', password: 'local password' }).expect(200)
    await local.post('/api/me/identities/ldap').set(site).send({ username: 'both', password }).expect(200)
    expect((await local.get('/api/me/identities')).body.identities).toHaveLength(2)
    await agent.post('/api/me/identities/ldap').set(site).send({ username: 'both', password }).expect(409)
    await gql(`mutation { removeUserFromGroup(userId: "reader", groupId: ${adminGroup}) { ok } }`)
    await gql(`mutation { removeUserFromGroup(userId: "reader", groupId: ${adultGroup}) { ok } }`)
    await agent.post('/api/auth/login').set(site).send({ username: 'reader', password }).expect(200)
    expect((await agent.get('/api/me')).body.user).toMatchObject({ id: 1, role: 'player', adult_access: 0 })
  })
})
