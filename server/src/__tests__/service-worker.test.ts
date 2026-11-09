// The library's service worker (selector/public/sw.js), run whole in node:vm with an in-memory Cache
// Storage and a network the test answers, or takes away. Requests go to it as fetch events, the way
// the browser sends them.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../../../selector/public/sw.js', import.meta.url), 'utf-8')
const origin = 'http://renplay.test'

type Answer = (url: string) => Response | undefined

function worker() {
  const stores = new Map<string, Map<string, Response>>()
  const keyOf = (req: string | { url: string }) => new URL(typeof req === 'string' ? req : req.url, origin).toString()
  const cache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      match: async (req: string | { url: string }) => store.get(keyOf(req))?.clone(),
      put: async (req: string | { url: string }, res: Response) => { store.set(keyOf(req), res) },
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (req: string | { url: string }) => store.delete(keyOf(req)),
    }
  }
  const caches = {
    open: async (name: string) => cache(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (req: string | { url: string }, opts: { cacheName: string }) => stores.get(opts.cacheName)?.get(keyOf(req))?.clone(),
  }
  let answer: Answer | null = () => undefined
  const asked: string[] = []
  const fetch = vi.fn(async (input: string | { url: string }) => {
    const url = keyOf(input)
    asked.push(url.slice(origin.length))
    const res = answer?.(url.slice(origin.length))
    if (!res) throw new TypeError('Failed to fetch')
    return res
  })
  const listeners: Record<string, Array<(event: any) => void>> = {}
  const self = {
    location: new URL(`${origin}/sw.js`),
    addEventListener: (type: string, fn: (event: any) => void) => { (listeners[type] ??= []).push(fn) },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }
  const later = (fn: () => void, ms: number) => setTimeout(fn, ms).unref()
  runInNewContext(source, { self, caches, fetch, Response, Headers, URL, URLSearchParams, ReadableStream, setTimeout: later, clearTimeout, console })

  return {
    keep: (name: string, url: string, body: string) => cache(name).put(url, new Response(body)),
    kept: (name: string, url: string) => stores.get(name)?.has(keyOf(url)) ?? false,
    asked,
    /** The server's answers by path, or null for no network. */
    serve: (next: Answer | null) => { answer = next },
    /** What the page gets for a request: the worker's answer, or the network's when it gives none. */
    async get(path: string, mode = 'no-cors'): Promise<Response> {
      let responded: Promise<Response> | undefined
      const event = { request: { url: origin + path, method: 'GET', mode, headers: new Headers() }, respondWith: (p: Promise<Response>) => { responded = p }, waitUntil: () => {} }
      for (const fn of listeners['fetch'] ?? []) fn(event)
      return responded ?? fetch(origin + path)
    },
  }
}

describe('service worker', () => {
  it('keeps what a kept game’s new page names, so it still plays offline after Renplay is upgraded', async () => {
    const sw = worker()
    await sw.keep('renplay-offline-g1', '/g/g1/b1/', '<script>window.__renplay={"userId":1}</script><script src="/renplay/runtime.js?v=old"></script>')
    await sw.keep('renplay-offline-g1', '/renplay/runtime.js?v=old', 'old runtime')
    await sw.keep('renplay-api-v1', '/api/me', JSON.stringify({ user: { id: 1 } }))
    await sw.keep('renplay-api-v1', '/api/games/g1', JSON.stringify({ game: { id: 'g1', nsfw: false, art: {} } }))

    // Online after an upgrade: the page names the new runtime.
    const manifest = { files: [{ url: '/g/g1/b1/' }, { url: '/renplay/runtime.js?v=new' }, { url: '/g/g1/b1/cache/a.rpyc?v=2' }, { url: '/g/g1/b1/game.zip' }] }
    sw.serve((path) => ({
      '/g/g1/b1/?adult=blurred': new Response('<script>window.__renplay={"userId":1}</script><script src="/renplay/runtime.js?v=new"></script>'),
      '/api/games/g1/offline?adult=blurred': Response.json(manifest),
      '/renplay/runtime.js?v=new': new Response('new runtime'),
      '/g/g1/b1/cache/a.rpyc?v=2': new Response('compiled'),
    } as Record<string, Response>)[path])
    expect(await (await sw.get('/g/g1/b1/?adult=blurred', 'navigate')).text()).toContain('runtime.js?v=new')
    await vi.waitFor(() => expect(sw.kept('renplay-offline-g1', '/g/g1/b1/cache/a.rpyc?v=2')).toBe(true))
    expect(sw.asked).not.toContain('/g/g1/b1/game.zip')

    // Offline: the page and everything it names come from this browser.
    sw.serve(null)
    expect(await (await sw.get('/g/g1/b1/', 'navigate')).text()).toContain('runtime.js?v=new')
    expect(await (await sw.get('/renplay/runtime.js?v=new')).text()).toBe('new runtime')
    expect(await (await sw.get('/g/g1/b1/cache/a.rpyc?v=2')).text()).toBe('compiled')
  })

  it('answers the person’s adult level offline, so a kept game’s art shows as it did online', async () => {
    const sw = worker()
    sw.serve((path) => (path === '/api/me/adult' ? Response.json({ effective: 'shown' }) : undefined))
    expect(await (await sw.get('/api/me/adult')).json()).toEqual({ effective: 'shown' })
    sw.serve(null)
    expect(await (await sw.get('/api/me/adult')).json()).toEqual({ effective: 'shown' })
  })
})
