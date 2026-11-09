import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import yazl from 'yazl'
import yauzl from 'yauzl'
import { SAVES_ZIP, SAVE_FILE_BYTES } from '../saves/savefile.js'
import { readZipEntries } from '../util/zip.js'
import { saveImport, IMPORT_MAX_BYTES } from '../saves/import-upload.js'
import { signInReturnUrl } from '../../../selector/src/lib/sign-in-return.js'
import { queueHtmlSave, replayHtmlSaves } from '../../../selector/src/lib/html-save-queue.js'

async function zip(entries: number, mode?: number): Promise<Buffer> {
  const z = new yazl.ZipFile(), chunks: Buffer[] = []
  for (let i = 0; i < entries; i++) z.addBuffer(Buffer.alloc(0), `save/${i}`, mode ? { mode } : {})
  z.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
  const result = new Promise<Buffer>((resolve) => z.outputStream.on('end', () => resolve(Buffer.concat(chunks))))
  z.end()
  return result
}

describe('security boundary regressions', () => {
  it('uses the browser URL parser and returns only canonical same-origin sign-in destinations', () => {
    const origin = 'https://renplay.test'
    for (const target of ['/\n/evil.example', '//evil.example', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', 'http://[']) expect(signInReturnUrl(target, origin)).toBe(`${origin}/`)
    expect(signInReturnUrl('/games/../account?x=1#section', origin)).toBe(`${origin}/account?x=1#section`)
    expect(signInReturnUrl(`${origin}/account`, origin)).toBe(`${origin}/account`)
  })
  it('rejects an entry-count bomb, traversal and symlink entries before opening content streams', async () => {
    const open = vi.spyOn(yauzl.ZipFile.prototype, 'openReadStream')
    await expect(readZipEntries(await zip(2049), () => true, SAVES_ZIP)).rejects.toThrow('Too many zip entries')
    await expect(readZipEntries(await zip(1, 0o120777), () => true, SAVES_ZIP)).rejects.toThrow('Zip links')
    // Replace same-length names in the local and central headers; yazl itself disallows traversal.
    const traversal = Buffer.from((await zip(1)).toString('latin1').replaceAll('save/0', '../bad'), 'latin1')
    await expect(readZipEntries(traversal, () => true, SAVES_ZIP)).rejects.toThrow(/invalid relative path|Invalid path/)
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })
  it('bounds individual and total expansion before reading even a preceding valid entry', async () => {
    const original = await zip(2)
    const bomb = Buffer.from(original)
    let pos = bomb.indexOf(Buffer.from('PK\x01\x02'))
    // The second central directory entry advertises an oversized expansion.
    pos = bomb.indexOf(Buffer.from('PK\x01\x02'), pos + 4)
    bomb.writeUInt32LE(65 << 20, pos + 24)
    const open = vi.spyOn(yauzl.ZipFile.prototype, 'openReadStream')
    await expect(readZipEntries(bomb, () => true, SAVES_ZIP)).rejects.toThrow('Zip contents too large')
    expect(open).not.toHaveBeenCalled(); open.mockClear()
    const totalBomb = Buffer.from(await zip(3))
    for (let offset = totalBomb.indexOf(Buffer.from('PK\x01\x02')); offset !== -1; offset = totalBomb.indexOf(Buffer.from('PK\x01\x02'), offset + 4)) totalBomb.writeUInt32LE(48 << 20, offset + 24)
    await expect(readZipEntries(totalBomb, () => true, SAVES_ZIP)).rejects.toThrow('Zip contents too large')
    expect(open).not.toHaveBeenCalled(); open.mockRestore()
  })
  it('spools multipart bodies to disk, bounds file/aggregate bytes and holds a shared concurrency budget', async () => {
    const app = express(), entered: Array<() => void> = [], paths: string[] = []
    app.post('/import', saveImport('files', async (req, res) => {
      paths.push((req.files as Express.Multer.File[])[0]!.path)
      expect((req.files as Express.Multer.File[])[0]!.buffer).toBeUndefined()
      await new Promise<void>((resolve) => entered.push(resolve))
      res.json({ ok: true })
    }))
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 400).json({ error: error.message }))
    const first = request(app).post('/import').attach('files', Buffer.from('a'), 'persistent').then((r) => r)
    const second = request(app).post('/import').attach('files', Buffer.from('b'), 'persistent').then((r) => r)
    await vi.waitFor(() => expect(entered).toHaveLength(2))
    await request(app).post('/import').attach('files', Buffer.from('c'), 'persistent').expect(429)
    entered.splice(0).forEach((resolve) => resolve())
    expect((await first).status).toBe(200); expect((await second).status).toBe(200)
    await vi.waitFor(() => paths.forEach((path) => expect(() => readFileSync(path)).toThrow()))
    await request(app).post('/import').set('Content-Length', String(IMPORT_MAX_BYTES + (2 << 20))).send('x').expect(413)
    await request(app).post('/import').attach('files', Buffer.alloc(SAVE_FILE_BYTES + 1), 'persistent').expect(400)
    // Three individually valid files cross the aggregate limit, including chunked requests. Streams
    // are what makes them chunked, and supertest's types leave them out.
    const chunked = () => Readable.from([Buffer.alloc(48 << 20)]) as unknown as Buffer
    await request(app).post('/import').attach('files', chunked(), 'persistent').attach('files', chunked(), 'persistent').attach('files', chunked(), 'persistent').expect(413)
  })
  it('keeps offline HTML state through A → B → A and uploads only owner-bound snapshots', async () => {
    const window: any = {}
    const vendor = readFileSync(new URL('../../../runtime/vendor/fake-indexeddb.js', import.meta.url), 'utf-8')
    runInNewContext(vendor, { window, structuredClone, setTimeout, clearTimeout, console, DOMException })
    vi.stubGlobal('indexedDB', new window.__renplayIDB.IDBFactory())
    const folders = new Map<number, string>()
    let current = 1, offline = true
    const fetch = vi.fn(async (_url, init) => {
      const owner = Number(init.headers['x-renplay-user'])
      if (offline) throw new TypeError('Offline')
      if (owner !== current) return new Response('', { status: 401 })
      folders.set(owner, init.body)
      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetch)
    try {
      await queueHtmlSave(1, 'html', 'Html/localStorage.json', '{"offline":"A"}')
      await expect(replayHtmlSaves(1, 'html')).rejects.toThrow('Offline')
      current = 2; offline = false
      await replayHtmlSaves(2, 'html')
      expect(folders.size).toBe(0)
      await queueHtmlSave(2, 'html', 'Html/localStorage.json', '{"online":"B"}')
      await replayHtmlSaves(2, 'html')
      current = 1
      await replayHtmlSaves(1, 'html')
      expect(folders.get(1)).toBe('{"offline":"A"}'); expect(folders.get(2)).toBe('{"online":"B"}')
      expect(fetch).toHaveBeenCalledTimes(3)
    } finally { vi.unstubAllGlobals() }
  })
})
