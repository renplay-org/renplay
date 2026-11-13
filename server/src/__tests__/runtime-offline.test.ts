import { describe, expect, it, vi } from 'vitest'
import { renpyRuntime, sharedMirror } from './runtime-browser.js'

/** A fetch the network answers only while `up` is true: down, it fails the way a browser does. */
function network() {
  const state = { up: true }
  const fetch = vi.fn(async (input: unknown) => {
    if (!state.up) throw new TypeError('Load failed')
    if (String(input).endsWith('/boot')) return new Response(JSON.stringify({ saveDir: 'Game', files: [], lazy: [] }))
    return new Response('picture')
  })
  return { state, fetch }
}

describe('a game that streams its files', () => {
  it('holds a streamed file while the browser is offline and fetches it again when the network is back', async () => {
    const net = network()
    const runtime = renpyRuntime({ userId: 1, indexedDB: sharedMirror(), fetch: net.fetch })
    await runtime.boot()
    runtime.window.navigator.onLine = false
    net.state.up = false
    let answer: Response | null = null
    let failure: unknown = null
    runtime.window.fetch('/g/game/b1/game/images/scene.webp').then((res: Response) => (answer = res), (e: unknown) => (failure = e))
    await new Promise((resolve) => setTimeout(resolve, 20))
    // Not failed, and not answered: it waits.
    expect(failure).toBeNull()
    expect(answer).toBeNull()
    net.state.up = true
    runtime.window.navigator.onLine = true
    runtime.fire('online')
    await vi.waitFor(() => expect(answer).not.toBeNull())
    expect(await (answer as unknown as Response).text()).toBe('picture')
  })

  it('does not hold what fails while the browser is online, or a request to the server\'s own routes', async () => {
    const net = network()
    const runtime = renpyRuntime({ userId: 1, indexedDB: sharedMirror(), fetch: net.fetch })
    await runtime.boot()
    runtime.window.navigator.onLine = true
    net.state.up = false
    await expect(runtime.window.fetch('/g/game/b1/game/images/scene.webp')).rejects.toThrow('Load failed')
    runtime.window.navigator.onLine = false
    await expect(runtime.window.fetch('/api/saves/game/list')).rejects.toThrow('Load failed')
  })

  it('stops waiting when the request is aborted', async () => {
    const net = network()
    const runtime = renpyRuntime({ userId: 1, indexedDB: sharedMirror(), fetch: net.fetch })
    await runtime.boot()
    runtime.window.navigator.onLine = false
    net.state.up = false
    const controller = new AbortController()
    const waiting = runtime.window.fetch('/g/game/b1/game/images/scene.webp', { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()
    await expect(waiting).rejects.toThrow('Load failed')
  })
})
