import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { capture, trimCatalog } from '../../../demo/static/capture.mjs'
import { createAnswer } from '../../../demo/static/sw/answer'
import { memoryStore } from '../../../demo/static/sw/memory-store'
import { ANSWERED } from './demo-static-routes.js'
import { demoServer, renpySave } from './demo-static-fixture.js'

/*
 * The static demo's stand-in must answer what the real server answers, in the same shapes. Each case here runs on the
 * stand-in (its answer()) and on the real server in demo mode, from the same state, and compares the status and the
 * JSON's shapes: the same keys, the same kinds of value. A null is not compared with a value, and an empty list is
 * not compared with a full one, because the two libraries hold different data on purpose. Run in order, so each case
 * sees what the ones before it did.
 */

type Shape = string | Shape[] | { [key: string]: Shape }
const shape = (v: unknown): Shape => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return v.length ? [v.map(shape).reduce(merge)] : []
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, shape(x)]))
  return typeof v
}
/** The union of two shapes of the same kind of value: a key one has and the other lacks stays, as optional. */
function merge(a: Shape, b: Shape): Shape {
  if (a === 'null') return b
  if (b === 'null') return a
  if (Array.isArray(a) && Array.isArray(b)) return a.length && b.length ? [merge(a[0]!, b[0]!)] : a.length ? a : b
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: Record<string, Shape> = {}
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = k in a && k in b ? merge(a[k]!, b[k]!) : (a[k] ?? b[k])!
    return out
  }
  return a
}
/** Where two shapes differ, as lines for a failure. */
function differences(real: Shape, stand: Shape, path = '$'): string[] {
  if (real === 'null' || stand === 'null') return []
  if (Array.isArray(real) || Array.isArray(stand)) {
    if (!Array.isArray(real) || !Array.isArray(stand)) return [`${path}: ${JSON.stringify(real)} against ${JSON.stringify(stand)}`]
    return real.length && stand.length ? differences(real[0]!, stand[0]!, `${path}[]`) : []
  }
  if (typeof real === 'object' && typeof stand === 'object') {
    const out: string[] = []
    for (const k of new Set([...Object.keys(real), ...Object.keys(stand)])) {
      if (!(k in real)) out.push(`${path}.${k}: only the stand-in has it`)
      else if (!(k in stand)) out.push(`${path}.${k}: only the real server has it`)
      else out.push(...differences(real[k]!, stand[k]!, `${path}.${k}`))
    }
    return out
  }
  return real === stand ? [] : [`${path}: ${String(real)} against ${String(stand)}`]
}

interface Case {
  /** The route as the server registers it (the list in demo-static-routes.test.ts). */
  route: string
  method: string
  path: string
  body?: unknown
  raw?: Buffer
  /** Keys the stand-in adds on purpose. */
  extra?: string[]
  /** What the build changes in the server's answer on purpose, before the two are compared. */
  expected?: (body: any) => unknown
}

const TQ = '/api/saves/the-question'
const FILE = `${TQ}/file?path=the_question-7/1-1-LT1.save`
const AGAIN = 'the_question-7/1-1-LT1.save'

describe('the static demo answers what the demo server answers', () => {
  let server: Awaited<ReturnType<typeof demoServer>>
  let cookie = ''
  let stand: (req: Request) => Promise<Response>
  let saveA: Buffer, saveB: Buffer
  let versionId = ''

  beforeAll(async () => {
    server = await demoServer()
    const { snapshot } = await capture({ base: server.base, embedder: 'https://renplay.org' })
    stand = createAnswer({ store: memoryStore(), snapshot: async () => snapshot as never, notify: () => {} })
    const guest = await fetch(`${server.base}/api/auth/demo`, { method: 'POST', headers: { origin: server.base } })
    cookie = guest.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    saveA = await renpySave('First', 1700000000)
    saveB = await renpySave('Second', 1700000100)
  })
  afterAll(async () => { await server.close() })

  const real = (c: Case) => fetch(server.base + c.path, { method: c.method, headers: { cookie, origin: server.base, ...(c.body ? { 'content-type': 'application/json' } : c.raw ? { 'content-type': 'application/octet-stream' } : {}) }, body: c.raw ? new Uint8Array(c.raw) : c.body ? JSON.stringify(c.body) : undefined })
  const standIn = (c: Case) => stand(new Request(`https://demo.test${c.path}`, { method: c.method, headers: c.body ? { 'content-type': 'application/json' } : {}, body: c.raw ? new Uint8Array(c.raw) : c.body ? JSON.stringify(c.body) : undefined }))

  /** Runs one case on both, compares, and gives the real answer's body back. */
  async function compare(c: Case): Promise<unknown> {
    const [a, b] = await Promise.all([real(c), standIn(c)])
    expect(b.status, `${c.method} ${c.path}`).toBe(a.status)
    const type = (r: Response) => r.headers.get('content-type')?.split(';')[0]
    expect(type(b), `${c.method} ${c.path} content type`).toBe(type(a))
    if (type(a) !== 'application/json') return null
    const [x, y] = [c.expected ? c.expected(await a.json()) : await a.json(), await b.json()]
    const stood = shape(y) as Record<string, Shape>
    for (const k of c.extra ?? []) delete stood[k]
    expect(differences(shape(x), stood), `${c.method} ${c.path}`).toEqual([])
    return x
  }

  // The routes the stand-in answers, one request each at least. The route names are those of the server's routers.
  const reads: Case[] = [
    { route: 'GET /me', method: 'GET', path: '/api/me', extra: ['demoStatic'] },
    { route: 'GET /me/adult', method: 'GET', path: '/api/me/adult' },
    { route: 'GET /me/tags', method: 'GET', path: '/api/me/tags' },
    { route: 'GET /auth/providers', method: 'GET', path: '/api/auth/providers' },
    { route: 'GET /health', method: 'GET', path: '/api/health' },
    { route: 'GET /defaults', method: 'GET', path: '/api/defaults' },
    { route: 'GET /content', method: 'GET', path: '/api/content' },
    { route: 'GET /widget', method: 'GET', path: '/api/widget' },
    { route: 'GET /catalog', method: 'GET', path: '/api/catalog', expected: trimCatalog },
    { route: 'GET /history', method: 'GET', path: '/api/history' },
    { route: 'GET /games', method: 'GET', path: '/api/games' },
    { route: 'GET /games/:id', method: 'GET', path: '/api/games/the-question' },
    { route: 'POST /auth/demo', method: 'POST', path: '/api/auth/demo', body: {} },
    { route: 'POST /telemetry/client', method: 'POST', path: '/api/telemetry/client', body: { device: 'phone' } },
    { route: 'GET /:id', method: 'GET', path: TQ },
    { route: 'GET /:id/boot', method: 'GET', path: `${TQ}/boot` },
    { route: 'GET /:id/history', method: 'GET', path: `${TQ}/history` },
  ]
  const progress: Case[] = [
    { route: 'PUT /games/:id/favorite', method: 'PUT', path: '/api/games/the-question/favorite', body: { on: true } },
    { route: 'PUT /games/:id/status', method: 'PUT', path: '/api/games/the-question/status', body: { status: 'playing' } },
    { route: 'PUT /games/:id/rating', method: 'PUT', path: '/api/games/the-question/rating', body: { rating: 4 } },
    { route: 'POST /games/:id/not-now', method: 'POST', path: '/api/games/the-question/not-now', body: {} },
    { route: 'DELETE /games/:id/not-now', method: 'DELETE', path: '/api/games/the-question/not-now' },
    { route: 'POST /games/:id/played', method: 'POST', path: '/api/games/the-question/played', body: {} },
    { route: 'POST /games/:id/play-time', method: 'POST', path: '/api/games/the-question/play-time', body: { seconds: 20 } },
    { route: 'GET /games/:id', method: 'GET', path: '/api/games/the-question' },
    { route: 'GET /history', method: 'GET', path: '/api/history' },
    { route: 'GET /games', method: 'GET', path: '/api/games' },
  ]

  it.each(reads)('$method $path', async (c) => { await compare(c) })
  it.each(progress)('$method $path (progress)', async (c) => { await compare(c) })

  it('saves: a first save, a second under the same name, and what they leave', async () => {
    const put = (raw: Buffer): Case => ({ route: 'PUT /:id/file', method: 'PUT', path: FILE, raw })
    await compare(put(saveA))
    await compare(put(saveB))
    await compare({ route: 'GET /:id', method: 'GET', path: TQ })
    await compare({ route: 'GET /:id/boot', method: 'GET', path: `${TQ}/boot` })
    await compare({ route: 'GET /:id/raw', method: 'GET', path: `${TQ}/raw?path=${AGAIN}` })
    await compare({ route: 'GET /:id/screenshot', method: 'GET', path: `${TQ}/screenshot?file=1-1-LT1.save` })
    await compare({ route: 'GET /:id/download', method: 'GET', path: `${TQ}/download?file=1-1-LT1.save` })
    await compare({ route: 'PUT /:id/meta', method: 'PUT', path: `${TQ}/meta?file=1-1-LT1.save`, body: { title: 'Before the question', note: 'A note', pinned: true } })
    await compare({ route: 'GET /:id', method: 'GET', path: TQ })
    await compare({ route: 'GET /games/:id', method: 'GET', path: '/api/games/the-question' })
    await compare({ route: 'POST /:id/save-dir', method: 'POST', path: `${TQ}/save-dir`, body: { saveDir: 'the_question-7' } })
    const history = (await compare({ route: 'GET /:id/history', method: 'GET', path: `${TQ}/history?file=1-1-LT1.save` })) as { versions: Array<{ id: string }> }
    expect(history.versions.length).toBe(1)
    versionId = history.versions[0]!.id
  })
  it('saves: restoring an earlier version, deleting a slot, and the game deleting a file', async () => {
    const standHistory = (await (await standIn({ route: '', method: 'GET', path: `${TQ}/history` })).json()) as { versions: Array<{ id: string }> }
    expect(standHistory.versions.length).toBe(1)
    const both = async (c: Case, id: string) => {
      const [a, b] = await Promise.all([fetch(server.base + c.path, { method: c.method, headers: { cookie, origin: server.base, 'content-type': 'application/json' }, body: JSON.stringify({ id }) }), standIn({ ...c, body: { id: standHistory.versions[0]!.id } })])
      expect(b.status).toBe(a.status)
      expect(differences(shape(await a.json()), shape(await b.json()))).toEqual([])
    }
    await both({ route: 'POST /:id/history/restore', method: 'POST', path: `${TQ}/history/restore` }, versionId)
    await compare({ route: 'DELETE /:id/slot', method: 'DELETE', path: `${TQ}/slot?file=1-1-LT1.save` })
    await compare({ route: 'PUT /:id/file', method: 'PUT', path: `${TQ}/file?path=the_question-7/2-1.save`, raw: saveA })
    await compare({ route: 'DELETE /:id/file', method: 'DELETE', path: `${TQ}/file?path=the_question-7/2-1.save` })
    await compare({ route: 'GET /:id/history', method: 'GET', path: `${TQ}/history` })
  })
  it('refuses what the demo server refuses, with the same words', async () => {
    const refused: Case[] = [
      { route: 'PUT /me', method: 'PUT', path: '/api/me', body: { name: 'x' } },
      { route: 'PUT /me/tags', method: 'PUT', path: '/api/me/tags', body: {} },
      { route: 'PUT /me/adult', method: 'PUT', path: '/api/me/adult', body: { level: 'shown' } },
      { route: 'POST /me/password', method: 'POST', path: '/api/me/password', body: {} },
      { route: 'GET /me/sessions', method: 'GET', path: '/api/me/sessions' },
      { route: 'POST /games/:id/art/upload', method: 'POST', path: '/api/games/the-question/art/upload', body: {} },
      { route: 'POST /:id/import', method: 'POST', path: `${TQ}/import`, body: {} },
      { route: 'POST /:id/sync', method: 'POST', path: `${TQ}/sync`, body: {} },
      { route: 'POST /:id/copy', method: 'POST', path: `${TQ}/copy`, body: {} },
    ]
    for (const c of refused) {
      const [a, b] = await Promise.all([real(c), standIn(c)])
      expect([b.status, await b.json()], `${c.method} ${c.path}`).toEqual([a.status, await a.json()])
    }
  })
  it('takes the compiled caches the runtime uploads, which the demo server refuses, so that no request fails', async () => {
    const c = { route: 'PUT /games/:id/cache', method: 'PUT', path: '/api/games/the-question/cache?build=b1&name=screens.rpyb', body: {} }
    expect((await real(c)).status).toBe(403)
    const answer = await standIn(c)
    expect([answer.status, await answer.json()]).toEqual([200, { ok: true }])
  })
  it('names the build\'s embedder as the one origin the bridge talks to, and says it has no server', async () => {
    const me = (await (await standIn({ route: '', method: 'GET', path: '/api/me' })).json()) as { demoEmbedder: string; demoStatic: boolean; demo: boolean }
    expect([me.demo, me.demoStatic, me.demoEmbedder]).toEqual([true, true, 'https://renplay.org'])
  })
  it('is told the same of a game it does not know', async () => {
    for (const c of [{ method: 'GET', path: '/api/games/no-such-game' }, { method: 'GET', path: '/api/saves/no-such-game' }] as Case[]) {
      const [a, b] = await Promise.all([real(c), standIn(c)])
      expect([b.status, await b.json()]).toEqual([a.status, await a.json()])
    }
  })
  it('the cases cover every route the stand-in answers', () => {
    const covered = new Set([...reads, ...progress].map((c) => c.route))
    for (const route of ['PUT /games/:id/cache', 'PUT /:id/file', 'GET /:id/raw', 'GET /:id/screenshot', 'GET /:id/download', 'PUT /:id/meta', 'POST /:id/save-dir', 'POST /:id/history/restore', 'DELETE /:id/slot', 'DELETE /:id/file']) covered.add(route)
    expect([...covered].sort()).toEqual([...ANSWERED].sort())
  })
})
