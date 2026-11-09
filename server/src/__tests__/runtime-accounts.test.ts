import { describe, expect, it, vi } from 'vitest'
import { htmlRuntime, putMirrorEntry, renpyRuntime, sharedMirror } from './runtime-browser.js'

const onlineFetch = () => vi.fn(async (input: unknown) => {
  if (String(input).endsWith('/boot')) return new Response(JSON.stringify({ saveDir: 'Game', files: [], lazy: [] }))
  return new Response('{}')
})

describe('runtime account isolation', () => {
  it('resends sandboxed HTML local storage after signing back in, even when the failed send cleared its dirty flag', () => {
    const runtime = htmlRuntime(1)
    runtime.window.localStorage.setItem('fixture', 'unsent')
    runtime.fire('pagehide')
    expect(runtime.post).toHaveBeenCalledTimes(1)
    // The player keeps it on this device, which clears the flag, then its upload fails: signed out.
    runtime.message({ type: 'renplay:storage-kept', data: '{"fixture":"unsent"}', userId: 1 })
    runtime.message({ type: 'renplay:resume-sync', userId: 2 })
    expect(runtime.post).toHaveBeenCalledTimes(1)
    runtime.message({ type: 'renplay:resume-sync', userId: 1 })
    expect(runtime.post).toHaveBeenCalledTimes(2)
    expect(runtime.post).toHaveBeenLastCalledWith(
      { type: 'renplay:storage', game: 'game', userId: 1, data: '{"fixture":"unsent"}' },
      'http://renplay.test',
    )
  })

  it('retries unacknowledged HTML IndexedDB snapshots and never acknowledges newer writes with an older snapshot', async () => {
    const runtime = htmlRuntime(1)
    const write = (value: string) => new Promise<void>((resolve, reject) => {
      const open = runtime.window.indexedDB.open('saves', 1)
      open.onupgradeneeded = () => open.result.createObjectStore('slots')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('slots', 'readwrite')
        tx.objectStore('slots').put(value, 'progress')
        tx.oncomplete = () => { db.close(); resolve() }
      }
    })
    await write('first'); await runtime.flush()
    const first = runtime.storagePosts().at(-1)!.data
    expect(first).toContain('first')
    await runtime.flush()
    expect(runtime.storagePosts()).toHaveLength(2)
    await write('second'); runtime.kept(first); await runtime.flush()
    const second = runtime.storagePosts().at(-1)!.data
    expect(second).toContain('second')
    runtime.kept(first); await runtime.flush()
    expect(runtime.storagePosts()).toHaveLength(4)
    runtime.kept(second); await runtime.flush()
    expect(runtime.storagePosts()).toHaveLength(4)
    expect(runtime.intervals).toHaveLength(1)
    await write('third'); runtime.intervals[0]!()
    await vi.waitFor(() => expect(runtime.storagePosts().at(-1)!.data).toContain('third'))
  })

  it('retains A’s offline writes through B playing and restores them only when A returns, and leaves entries without an account alone', async () => {
    const indexedDB = sharedMirror()
    const a = renpyRuntime({ userId: 1, indexedDB, fetch: vi.fn(async () => { throw new TypeError('Offline') }), framed: false })
    a.write('Game/persistent', new Uint8Array([1]), 10)
    await a.idle()
    await vi.waitFor(async () => expect(await a.entries()).toMatchObject([{ key: '1:Game/persistent', userId: 1, synced: 0 }]))
    await putMirrorEntry(indexedDB, { key: 'older/path', path: 'older/path', synced: 0 })

    const b = renpyRuntime({ userId: 2, indexedDB, fetch: onlineFetch(), framed: false })
    await b.boot()
    expect(b.read('Game/persistent')).toBeNull()
    expect(await b.entries()).toMatchObject([
      { key: '1:Game/persistent', userId: 1, synced: 0 },
      { key: 'older/path', path: 'older/path', synced: 0 },
    ])
    b.write('Game/persistent', new Uint8Array([2]), 11)
    await b.idle()
    await vi.waitFor(async () => expect((await b.entries()).find((entry) => entry.userId === 2)).toMatchObject({ key: '2:Game/persistent', synced: 1 }))
    expect(await b.entries()).toMatchObject([
      { key: '1:Game/persistent', userId: 1, data: new Uint8Array([1]), synced: 0 },
      { key: '2:Game/persistent', userId: 2, data: new Uint8Array([2]), synced: 1 },
      { key: 'older/path', path: 'older/path', synced: 0 },
    ])

    const returning = renpyRuntime({ userId: 1, indexedDB, fetch: onlineFetch(), framed: false })
    expect(await returning.entries()).toMatchObject([
      { key: '1:Game/persistent', userId: 1, data: new Uint8Array([1]), synced: 0 },
      { key: '2:Game/persistent', userId: 2, data: new Uint8Array([2]), synced: 1 },
      { key: 'older/path', path: 'older/path', synced: 0 },
    ])
    await returning.boot()
    await returning.idle()
    expect(returning.read('Game/persistent')).toEqual([1])
    const older = (await returning.entries()).find((entry) => entry.key === 'older/path')
    expect(older).toEqual({ key: 'older/path', path: 'older/path', synced: 0 })
    for (const page of [a, b, returning]) expect(page.post).not.toHaveBeenCalled()
  })

  it('treats 401 as signed out, keeps the failed upload under that user, and stops retries rather than uploading into another account', async () => {
    const indexedDB = sharedMirror()
    const fetch = vi.fn(async (_input: unknown, _init: any) => new Response('{}', { status: 401 }))
    const runtime = renpyRuntime({ userId: 1, indexedDB, fetch })
    runtime.write('Game/persistent', new Uint8Array([1]), 1)
    await runtime.idle()
    await vi.waitFor(() => expect(runtime.post.mock.calls.some(([message]) => message.type === 'renplay:signed-out')).toBe(true))
    expect(runtime.runtime.state.queue.size).toBe(1)
    expect(runtime.post).toHaveBeenCalledWith(
      { type: 'renplay:signed-out', game: 'game', userId: 1 },
      'http://renplay.test',
    )
    expect(fetch.mock.calls[0]![1].headers.get('x-renplay-user')).toBe('1')
    expect(await runtime.entries()).toMatchObject([{ key: '1:Game/persistent', userId: 1, synced: 0 }])
    runtime.message({ type: 'renplay:resume-sync', userId: 2 })
    expect(runtime.runDelayed(1000)).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await runtime.entries()).toMatchObject([{ key: '1:Game/persistent', userId: 1, synced: 0 }])
  })
})
