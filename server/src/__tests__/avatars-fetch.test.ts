import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { request } from 'node:https'
import { lookup } from 'node:dns'
import { beforeEach, expect, it, vi } from 'vitest'
import { AVATAR_LIMIT, fetchAvatar } from '../accounts/avatars.js'

vi.mock('node:https', () => ({ request: vi.fn() }))
vi.mock('node:dns', () => ({ lookup: vi.fn() }))
let status = 200, contentType = 'image/png', contentLength = '3', chunks = [Buffer.from('png')]
beforeEach(() => {
  status = 200; contentType = 'image/png'; contentLength = '3'; chunks = [Buffer.from('png')]
  vi.mocked(request).mockImplementation(((_url: URL, _options: unknown, callback: (res: unknown) => void) => {
    const req = Object.assign(new EventEmitter(), { end: () => queueMicrotask(() => { const res = Object.assign(Readable.from(chunks), { statusCode: status, headers: { 'content-type': contentType, 'content-length': contentLength } }); callback(res) }), destroy: (e: Error) => req.emit('error', e) })
    return req
  }) as unknown as typeof request)
})
it('fetches allowed image bytes without following redirects, and caps advertised and streamed sizes and content types', async () => {
  expect((await fetchAvatar('https://pictures.example/avatar.png')).toString()).toBe('png')
  for (const code of [301, 302, 307, 404]) { status = code; await expect(fetchAvatar('https://pictures.example/a')).rejects.toThrow('Unsupported') }
  status = 200; contentType = 'image/svg+xml'
  await expect(fetchAvatar('https://pictures.example/a')).rejects.toThrow('Unsupported')
  contentType = 'image/png'; contentLength = String(AVATAR_LIMIT + 1)
  await expect(fetchAvatar('https://pictures.example/a')).rejects.toThrow('Unsupported')
  contentLength = '0'; chunks = [Buffer.alloc(AVATAR_LIMIT), Buffer.alloc(1)]
  await expect(fetchAvatar('https://pictures.example/a')).rejects.toThrow('too large')
})
it('pins resolution to checked public addresses and rejects mixed public/private DNS answers', async () => {
  await fetchAvatar('https://pictures.example/a')
  const options = vi.mocked(request).mock.calls.at(-1)![1] as { lookup: (host: string, options: unknown, cb: (...args: unknown[]) => void) => void }
  for (const addresses of [[{ address: '127.0.0.1', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]]) {
    vi.mocked(lookup).mockImplementation(((_host: string, _opts: unknown, cb: (error: null, addresses: unknown) => void) => cb(null, addresses)) as unknown as typeof lookup)
    const cb = vi.fn(); options.lookup('pictures.example', { all: true }, cb)
    expect(cb.mock.calls[0]![0]).toBeInstanceOf(Error)
  }
  vi.mocked(lookup).mockImplementation(((_host: string, _opts: unknown, cb: (error: null, addresses: unknown) => void) => cb(null, [{ address: '8.8.8.8', family: 4 }])) as unknown as typeof lookup)
  const cb = vi.fn(); options.lookup('pictures.example', { all: true }, cb)
  expect(cb).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }])
})
