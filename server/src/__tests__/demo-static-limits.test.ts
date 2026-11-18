import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { capture } from '../../../demo/static/capture.mjs'
import { createAnswer } from '../../../demo/static/sw/answer'
import { memoryStore } from '../../../demo/static/sw/memory-store'
import { DEMO_REFUSAL, demoStaticRefuses } from '../shared/demo-refusals.js'
import { DEMO_ROUTES } from './demo-static-routes.js'
import { demoServer, renpySave } from './demo-static-fixture.js'

/*
 * The static demo lets a visitor do what playing needs, and nothing else. Each request here is a hand-made one, the way a
 * visitor with the developer tools open would send it, and the stand-in refuses it with the demo's words. The ones in
 * `limited` the demo server accepts from its guest, so the limit is the static demo's own.
 */

const TQ = '/api/saves/the-question'
const GAME = '/api/games/the-question'
const SAVE = `${TQ}/file?path=the_question-7/1-1-LT1.save`

interface Hand { method: string; path: string; body?: unknown }

/** Every kind of thing the static demo does not let a visitor do, by what it is. */
const LIMITED: Record<string, Hand[]> = {
  'a save\'s download': [{ method: 'GET', path: `${TQ}/download?file=1-1-LT1.save` }],
  'a save\'s note and pin': [
    { method: 'PUT', path: `${TQ}/meta?file=1-1-LT1.save`, body: { title: 'A name', note: 'A note' } },
    { method: 'PUT', path: `${TQ}/meta?file=1-1-LT1.save`, body: { pinned: true } },
  ],
  'favourites, status and rating': [
    { method: 'PUT', path: `${GAME}/favorite`, body: { on: true } },
    { method: 'PUT', path: `${GAME}/status`, body: { status: 'playing' } },
    { method: 'PUT', path: `${GAME}/rating`, body: { rating: 4 } },
    { method: 'POST', path: `${GAME}/not-now`, body: {} },
    { method: 'DELETE', path: `${GAME}/not-now` },
  ],
  'deleting and restoring saves, importing, copying and sync codes': [
    { method: 'DELETE', path: `${TQ}/slot?file=1-1-LT1.save` },
    { method: 'POST', path: `${TQ}/history/restore`, body: { id: 'x' } },
    { method: 'POST', path: `${TQ}/save-dir`, body: { saveDir: 'x' } },
    { method: 'POST', path: `${TQ}/import`, body: {} },
    { method: 'POST', path: `${TQ}/copy`, body: {} },
    { method: 'POST', path: `${TQ}/sync`, body: {} },
    { method: 'POST', path: `${TQ}/sync/download`, body: {} },
    { method: 'POST', path: '/api/saves-import', body: {} },
  ],
  'settings and the account': [
    { method: 'PUT', path: '/api/me', body: { name: 'x' } },
    { method: 'PUT', path: '/api/me/adult', body: { level: 'shown' } },
    { method: 'PUT', path: '/api/me/tags', body: {} },
    { method: 'PUT', path: '/api/me/pin', body: { pin: '1234' } },
    { method: 'POST', path: '/api/me/avatar', body: {} },
    { method: 'POST', path: '/api/me/password', body: {} },
    { method: 'POST', path: '/api/me/tokens', body: { name: 'x' } },
    { method: 'DELETE', path: '/api/me/sessions' },
    { method: 'POST', path: '/api/auth/logout', body: {} },
    { method: 'POST', path: '/api/auth/switch', body: {} },
    { method: 'PUT', path: '/api/defaults', body: {} },
    { method: 'PUT', path: '/api/content', body: {} },
    { method: 'PUT', path: '/api/system/sync', body: {} },
  ],
  'people, backups and other admin work': [
    { method: 'POST', path: '/api/users', body: {} },
    { method: 'PUT', path: '/api/users/1', body: {} },
    { method: 'DELETE', path: '/api/users/1' },
    { method: 'POST', path: '/api/system/backups', body: {} },
    { method: 'POST', path: '/api/system/prune', body: {} },
    { method: 'DELETE', path: '/api/system/storage/saves/Gone-1' },
    { method: 'POST', path: '/api/system/storage/deleted-saves/2026-12-01T10-00-00.000Z-Gone-1/restore', body: {} },
  ],
  'adding games, mods and files': [
    { method: 'POST', path: '/api/imports', body: {} },
    { method: 'POST', path: '/api/uploads', body: {} },
    { method: 'POST', path: '/api/archives/inspect', body: {} },
    { method: 'POST', path: '/api/catalog/refresh', body: {} },
    { method: 'POST', path: `${GAME}/reinstall`, body: {} },
    { method: 'DELETE', path: GAME },
    { method: 'POST', path: `${GAME}/files/upload`, body: {} },
    { method: 'PUT', path: `${GAME}/files/raw`, body: {} },
    { method: 'POST', path: `${GAME}/walkthroughs`, body: {} },
    { method: 'POST', path: `${GAME}/art/upload`, body: {} },
    { method: 'PUT', path: `${GAME}/art`, body: {} },
  ],
}

/** Reads the stand-in has no answer for: exports, the file browser, logs, backups. Nothing comes out of them. */
const NOT_ANSWERED: Hand[] = [
  { method: 'GET', path: '/api/saves-export' },
  { method: 'GET', path: `${TQ}/export` },
  { method: 'GET', path: `${GAME}/files` },
  { method: 'GET', path: `${GAME}/files/raw?path=game/script.rpy` },
  { method: 'GET', path: '/api/jobs/1/log' },
  { method: 'GET', path: '/api/system/backups/x.zip' },
  { method: 'GET', path: '/api/users' },
  { method: 'GET', path: '/api/system' },
]

describe('the static demo refuses what playing does not need', () => {
  let server: Awaited<ReturnType<typeof demoServer>>
  let cookie = ''
  let stand: (req: Request) => Promise<Response>

  beforeAll(async () => {
    server = await demoServer()
    const { snapshot } = await capture({ base: server.base, embedder: 'https://renplay.org' })
    stand = createAnswer({ store: memoryStore(), snapshot: async () => snapshot as never, notify: () => {} })
    const guest = await fetch(`${server.base}/api/auth/demo`, { method: 'POST', headers: { origin: server.base } })
    cookie = guest.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  })
  afterAll(async () => { await server.close() })

  const send = (h: Hand) => stand(new Request(`https://demo.test${h.path}`, { method: h.method, headers: h.body ? { 'content-type': 'application/json' } : {}, body: h.body ? JSON.stringify(h.body) : undefined }))
  const real = (h: Hand) => fetch(server.base + h.path, { method: h.method, headers: { cookie, origin: server.base, ...(h.body ? { 'content-type': 'application/json' } : {}) }, body: h.body ? JSON.stringify(h.body) : undefined })

  for (const [kind, hands] of Object.entries(LIMITED)) {
    it.each(hands)(`${kind}: $method $path`, async (h) => {
      const answer = await send(h)
      expect([answer.status, (await answer.json()) as unknown]).toEqual([403, { error: DEMO_REFUSAL }])
      expect(demoStaticRefuses(h.method, h.path.split('?')[0]!, h.body as object | undefined)).toBe(true)
    })
  }

  it.each(NOT_ANSWERED)('gives nothing for $method $path', async (h) => {
    const answer = await send(h)
    expect([403, 404]).toContain(answer.status)
    expect(answer.headers.get('content-type')).toContain('application/json')
  })

  it('is a limit of its own for what the demo server lets its guest do', async () => {
    const lets = [...LIMITED['favourites, status and rating']!, ...LIMITED['a save\'s download']!, ...LIMITED['a save\'s note and pin']!, LIMITED['deleting and restoring saves, importing, copying and sync codes']![0]!, LIMITED['deleting and restoring saves, importing, copying and sync codes']![1]!]
    // A download and a restore need a save to exist, so the guest makes one first.
    await fetch(server.base + SAVE, { method: 'PUT', headers: { cookie, origin: server.base, 'content-type': 'application/octet-stream' }, body: new Uint8Array(await renpySave('First', 1700000000)) })
    for (const h of lets) expect((await real(h)).status, `${h.method} ${h.path}`).not.toBe(403)
  })

  it('refuses every route of the server that is not answered, whatever its kind', () => {
    const fill = (route: string) => route.replace(/:\w+/g, 'x')
    const hands: Hand[] = []
    for (const kind of ['limited', 'hidden', 'refused'] as const)
      for (const entry of DEMO_ROUTES[kind]) {
        const [method, path] = entry.split(' ') as [string, string]
        if (method === 'GET' || path === '/') continue
        hands.push({ method, path: path.startsWith('/:id') ? `/api/saves/the-question${fill(path.slice(4))}` : path.startsWith('/api/') ? fill(path) : `/api${fill(path)}` })
      }
    expect(hands.length).toBeGreaterThan(60)
    expect(hands.filter((h) => !demoStaticRefuses(h.method, h.path))).toEqual([])
  })

  it('keeps what playing needs', async () => {
    const kept: Array<[Hand, number]> = [
      [{ method: 'POST', path: `${GAME}/played`, body: {} }, 200],
      [{ method: 'POST', path: `${GAME}/play-time`, body: { seconds: 20 } }, 200],
      [{ method: 'PUT', path: `${GAME}/cache?build=b1&name=screens.rpyb`, body: {} }, 200],
      [{ method: 'DELETE', path: `${TQ}/file?path=the_question-7/9-9.save` }, 200],
    ]
    for (const [h, status] of kept) expect((await send(h)).status, `${h.method} ${h.path}`).toBe(status)
    const save = await stand(new Request(`https://demo.test${SAVE}`, { method: 'PUT', body: new Uint8Array(await renpySave('First', 1700000000)) }))
    expect(save.status).toBe(200)
    const named = await send({ method: 'PUT', path: `${TQ}/meta?file=1-1-LT1.save`, body: { title: 'Before the question' } })
    expect([named.status, ((await named.json()) as { title: string }).title]).toEqual([200, 'Before the question'])
  })

  it('keeps a save\'s name, and refuses its note and pin by what the request says', () => {
    const meta = `${TQ}/meta`
    expect(demoStaticRefuses('PUT', meta, { title: 'A name' })).toBe(false)
    expect(demoStaticRefuses('PUT', meta, { title: 'A name', note: 'x' })).toBe(true)
    expect(demoStaticRefuses('PUT', meta, { pinned: false })).toBe(true)
  })

  it('has no way to pin or note a save, though a save made before this limit stays as it was', async () => {
    const pinned = await send({ method: 'PUT', path: `${TQ}/meta?file=1-1-LT1.save`, body: { title: 'Again', pinned: false } })
    expect(pinned.status).toBe(403)
  })
})
