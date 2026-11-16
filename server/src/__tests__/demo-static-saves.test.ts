import { beforeEach, describe, expect, it } from 'vitest'
import { createAnswer } from '../../../demo/static/sw/answer'
import { memoryStore } from '../../../demo/static/sw/memory-store'
import type { Store } from '../../../demo/static/sw/types'

/*
 * What a visitor's saves may take in their browser: the server demo's limits (a file of 2 MB, 32 MB and 1,000 files
 * in all) count the earlier versions too, since they are in the browser's storage as well. Everything here runs on
 * the stand-in alone, in memory.
 */

const DIR = 'the_question-7'
const MB = 1 << 20

describe('the static demo\'s saves', () => {
  let store: Store
  let answer: (req: Request) => Promise<Response>

  beforeEach(() => {
    store = memoryStore()
    answer = createAnswer({
      store,
      snapshot: async () => ({ routes: {}, me: {}, games: [{ id: 'the-question', title: 'The Question', saveDir: DIR, art: {} }] }) as never,
      notify: () => {},
    })
  })

  const call = (method: string, path: string, body?: BodyInit | object) =>
    answer(new Request(`https://demo.test/api/saves/the-question${path}`, {
      method,
      ...(body === undefined ? {} : body instanceof Uint8Array ? { body: body as BodyInit } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }))
  /** A payload of the given size that no other call's is the same as. */
  const payload = (size: number, n: number) => { const data = new Uint8Array(size); data.fill(n % 251); new DataView(data.buffer).setUint32(0, n); return data }
  const put = (file: string, data: Uint8Array) => call('PUT', `/file?path=${DIR}/${file}`, data)
  const pin = (file: string) => call('PUT', `/meta?file=${file}`, { pinned: true })
  /** What the browser keeps: the files and every version. */
  const held = async () => {
    const files = await store.all('files'), versions = await store.all('versions')
    return { bytes: [...files, ...versions].reduce((n, r) => n + r.data.byteLength, 0), entries: files.length + versions.length, versions: versions.length }
  }

  it('bounds the earlier versions of a pinned save by the quota, as the server does', async () => {
    expect((await put('1-1.save', payload(1.5 * MB, 0))).status).toBe(200)
    await pin('1-1.save')
    let refused = 0
    for (let i = 1; i < 60 && !refused; i++) if ((await put('1-1.save', payload(1.5 * MB, i))).status === 507) refused = i
    expect(refused).toBeGreaterThan(0)
    expect((await held()).bytes).toBeLessThanOrEqual(32 * MB)
  })

  it('bounds the earlier versions of a pinned save by the 1,000 files', async () => {
    await put('1-1.save', payload(8, 0))
    await pin('1-1.save')
    let refused = 0
    for (let i = 1; i < 1200 && !refused; i++) if ((await put('1-1.save', payload(8, i))).status === 507) refused = i
    expect(refused).toBeGreaterThan(0)
    expect((await held()).entries).toBeLessThanOrEqual(1000)
  })

  it('keeps three earlier versions of an unpinned save, and writes on within the quota', async () => {
    for (let i = 0; i < 40; i++) expect((await put('1-1.save', payload(1.5 * MB, i))).status).toBe(200)
    const now = await held()
    expect(now.versions).toBe(3)
    expect(now.bytes).toBeLessThanOrEqual(32 * MB)
  })

  it('refuses a restore that would take the saves past the quota', async () => {
    await put('1-1.save', payload(1.5 * MB, 0))
    await pin('1-1.save')
    for (let i = 1; (await held()).bytes + 1.5 * MB <= 32 * MB; i++) expect((await put('1-1.save', payload(1.5 * MB, i))).status).toBe(200)
    const before = await held()
    const [oldest] = (await store.all('versions')).sort((a, b) => a.savedAt - b.savedAt)
    const restored = await call('POST', '/history/restore', { id: oldest!.id })
    expect(restored.status).toBe(507)
    expect(await held()).toEqual(before)
  })

  it('lets a delete go on when the saves are full, since the file only moves to its history', async () => {
    await put('1-1.save', payload(1.5 * MB, 0))
    await pin('1-1.save')
    for (let i = 1; (await held()).bytes + 1.5 * MB <= 32 * MB; i++) await put('1-1.save', payload(1.5 * MB, i))
    const before = await held()
    expect((await call('DELETE', '/slot?file=1-1.save')).status).toBe(200)
    const after = await held()
    expect([after.bytes, after.entries]).toEqual([before.bytes, before.entries])
  })
})
