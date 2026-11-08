import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchPublic, resolver } from '../util/net.js'

describe('fetchPublic', () => {
  let server: Server
  let port = 0
  const asked: string[] = []
  beforeAll(async () => {
    server = createServer((req, res) => {
      asked.push(req.url ?? '')
      res.end('inside')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))
  afterEach(() => {
    vi.restoreAllMocks()
    asked.length = 0
  })

  it('connects only to addresses it checked: a name that turns local after the check is refused', async () => {
    let lookups = 0
    vi.spyOn(resolver, 'lookup').mockImplementation(async () => (++lookups === 1 ? ['93.184.216.34'] : ['127.0.0.1']))
    await expect(fetchPublic(`http://rebind.example:${port}/secret`)).rejects.toThrow(/rebind.example is not on the public internet/)
    expect(lookups).toBe(2)
    expect(asked).toEqual([])
  })

  it('still reaches a catalog host on the local network by its name', async () => {
    vi.spyOn(resolver, 'lookup').mockResolvedValue(['127.0.0.1'])
    const res = await fetchPublic(`http://catalog.lan:${port}/index.json`, { allowHosts: new Set(['catalog.lan']) })
    expect(await res.text()).toBe('inside')
    expect(asked).toEqual(['/index.json'])
  })
})
