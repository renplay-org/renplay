import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import yazl from 'yazl'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { openZip, type SourceEntry } from '../pipeline/archive.js'
import type { JobContext } from '../jobs/manager.js'
import { ImageProcessor, defaultImagePolicy } from '../pipeline/optimize.js'
import { PackWriter } from '../pipeline/pack.js'
import { detectLayout, extractProject } from '../pipeline/project.js'
import { readRpaIndex, splitRpa, streamRpaFile } from '../pipeline/rpa.js'

/** Minimal protocol-2 pickle writer for {str: [(int, int, bytes)]}. */
function pickleIndex(index: Record<string, Array<[number, number, Buffer]>>): Buffer {
  const parts: Buffer[] = [Buffer.from([0x80, 2, 0x7d, 0x28])] // PROTO 2, EMPTY_DICT, MARK
  const int = (n: number) => {
    let hex = BigInt(n).toString(16)
    if (hex.length % 2) hex = '0' + hex
    const be = Buffer.from(hex, 'hex')
    const le = Buffer.from(be).reverse()
    const bytes = le[le.length - 1]! & 0x80 ? Buffer.concat([le, Buffer.from([0])]) : le
    return Buffer.concat([Buffer.from([0x8a, bytes.length]), bytes]) // LONG1
  }
  for (const [k, entries] of Object.entries(index)) {
    const kb = Buffer.from(k, 'utf-8')
    const len = Buffer.alloc(4)
    len.writeUInt32LE(kb.length)
    parts.push(Buffer.from([0x58]), len, kb, Buffer.from([0x5d, 0x28])) // BINUNICODE, EMPTY_LIST, MARK
    for (const [o, l, prefix] of entries) {
      parts.push(int(o), int(l), Buffer.from([0x43, prefix.length]), prefix, Buffer.from([0x87])) // SHORT_BINBYTES, TUPLE3
    }
    parts.push(Buffer.from([0x65])) // APPENDS
  }
  parts.push(Buffer.from([0x75, 0x2e])) // SETITEMS, STOP
  return Buffer.concat(parts)
}

function buildRpa(files: Record<string, Buffer>, key = 0x5a5a1234, shared = false): Buffer {
  const chunks: Buffer[] = []
  const header = Buffer.alloc(34)
  let pos = header.length
  const index: Record<string, Array<[number, number, Buffer]>> = {}
  for (const [name, data] of Object.entries(files)) {
    chunks.push(Buffer.from('Made with Ren\'Py.'))
    pos += 17
    index[name] = [[pos ^ key, data.length ^ key, Buffer.alloc(0)]]
    chunks.push(data)
    pos += data.length
  }
  if (shared) {
    // Second name pointing at the first file's bytes (deduplicated archives).
    const first = Object.keys(files)[0]!
    index['dup/' + first] = index[first]!.map((t) => [...t] as [number, number, Buffer])
  }
  const idx = deflateSync(pickleIndex(index))
  header.write(`RPA-3.0 ${pos.toString(16).padStart(16, '0')} ${key.toString(16).padStart(8, '0')}\n`, 'latin1')
  return Buffer.concat([header, ...chunks, idx])
}

async function zipOf(entries: Record<string, Buffer>, compress: boolean): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'rpa-'))
  const path = join(dir, 'game.zip')
  const z = new yazl.ZipFile()
  for (const [name, data] of Object.entries(entries)) z.addBuffer(data, name, { compress })
  z.end()
  await pipeline(z.outputStream, createWriteStream(path))
  return path
}

const files = {
  'images/a b.png': Buffer.from('PNG-A'.repeat(1000)),
  'audio/track.ogg': Buffer.from('OGG'.repeat(77)),
  'script.rpyc': Buffer.from('RENPY RPC2 something'),
  'empty.txt': Buffer.alloc(0),
}

describe('RPA streaming split', () => {
  for (const compress of [true, false]) {
    it(`extracts every file from a ${compress ? 'deflated' : 'stored'} zip entry`, async () => {
      const zip = await zipOf({ 'MyGame-1.0-pc/game/archive.rpa': buildRpa(files, 0x5a5a1234, true), 'MyGame-1.0-pc/game/script.rpy': Buffer.from('label start:') }, compress)
      const src = await openZip(zip)
      expect(detectLayout(src.entries)).toEqual({ kind: 'project', root: 'MyGame-1.0-pc/' })
      const entry = src.entries.find((e) => e.path.endsWith('.rpa'))!
      expect(entry.seekable).toBe(!compress)
      const idx = await readRpaIndex(entry)
      expect(idx?.files.map((f) => f.name).sort()).toEqual([...Object.keys(files), 'dup/images/a b.png'].sort())
      const got = new Map<string, Buffer>()
      const deferred: string[] = []
      await splitRpa(entry, idx!.files, {
        open: async (name) => {
          const chunks: Buffer[] = []
          return { write: (c) => void chunks.push(Buffer.from(c)), end: async () => void got.set(name, Buffer.concat(chunks)) }
        },
        deferred: async (f) => void deferred.push(f.name),
      })
      for (const [name, data] of Object.entries(files)) expect(got.get(name)?.equals(data)).toBe(true)
      expect(deferred).toEqual(['dup/images/a b.png'])
      src.close()
    })
  }

  for (const seekable of [true, false]) {
    it(`streams a 600 MiB deferred entry with bounded read-ahead (seekable: ${seekable})`, async () => {
      const size = 600 * 1024 * 1024
      const chunk = Buffer.alloc(64 << 10, 0x61)
      let produced = 0
      let consumed = 0
      let peakAhead = 0
      const entry: SourceEntry = {
        path: 'archive.rpa', size, seekable,
        open: async () => Readable.from((async function* () {
          for (let n = 0; n < size; n += chunk.length) {
            produced += chunk.length
            peakAhead = Math.max(peakAhead, produced - consumed)
            yield chunk
          }
        })(), { objectMode: false, highWaterMark: chunk.length }),
      }
      for await (const c of streamRpaFile(entry, { name: 'images with spaces/large.webm', segments: [{ offset: 0, length: size, prefix: new Uint8Array() }] })) {
        consumed += c.length
        expect(c.length).toBeLessThanOrEqual(3 * chunk.length)
        if (consumed % (16 << 20) === 0) await new Promise((resolve) => setImmediate(resolve))
      }
      expect(consumed).toBe(size)
      expect(peakAhead).toBeLessThanOrEqual(5 * chunk.length)
    })
  }

  it('rejects an oversized index before reading its body', async () => {
    let opens = 0
    const header = Buffer.from('RPA-3.0 0000000000000040 00000000\n'.padEnd(64, ' '))
    const entry: SourceEntry = {
      path: 'huge-index.rpa', size: 64 + (33 << 20), seekable: true,
      open: async () => { opens++; return Readable.from([header]) },
    }
    await expect(readRpaIndex(entry)).rejects.toThrow('RPA index too large')
    expect(opens).toBe(1)
  })

  it('streams prefixes and multiple segments and rejects truncated entries', async () => {
    const data = Buffer.from('0123456789')
    const entry: SourceEntry = { path: 'a.rpa', size: data.length, seekable: false, open: async () => Readable.from([data]) }
    const chunks: Buffer[] = []
    for await (const c of streamRpaFile(entry, { name: 'multi', segments: [
      { offset: 2, length: 3, prefix: Buffer.from('a') },
      { offset: 8, length: 2, prefix: Buffer.from('b') },
    ] })) chunks.push(c)
    expect(Buffer.concat(chunks).toString()).toBe('a234b89')
    await expect(async () => {
      for await (const _ of streamRpaFile(entry, { name: 'short', segments: [{ offset: 9, length: 2, prefix: new Uint8Array() }] })) { /* drain */ }
    }).rejects.toThrow('RPA ended inside short')
  })

  it('detects prebuilt web builds', async () => {
    const zip = await zipOf({ 'x/index.html': Buffer.from('<html>'), 'x/game.zip': Buffer.from('PK'), 'x/renpy.wasm': Buffer.from('w') }, true)
    const src = await openZip(zip)
    expect(detectLayout(src.entries)).toEqual({ kind: 'web', root: 'x/' })
    src.close()
  })

  it('takes the game with Ren\'Py beside it over a developer\'s launcher project with more scripts', async () => {
    const root = 'Innocent_Witches-0-11-7-pc/'
    const launcher: Record<string, Buffer> = {}
    for (let i = 0; i < 40; i++) launcher[`${root}launcher/game/screen${i}.rpy`] = Buffer.from('screen s:')
    const zip = await zipOf(
      {
        [`${root}game/scripts.rpa`]: Buffer.from('RPA-3.0 x'),
        [`${root}game/images.rpa`]: Buffer.from('RPA-3.0 y'),
        [`${root}game/options.rpy`]: Buffer.from('define x = 1'),
        [`${root}renpy/__init__.py`]: Buffer.from('version = 8'),
        [`${root}renpy/common/00start.rpy`]: Buffer.from('init: pass'),
        ...launcher,
      },
      true,
    )
    const src = await openZip(zip)
    expect(detectLayout(src.entries)).toEqual({ kind: 'project', root })
    src.close()
  })

  it('ignores archives without a Ren\'Py game', async () => {
    const zip = await zipOf({ 'readme.txt': Buffer.from('hi') }, true)
    const src = await openZip(zip)
    expect(detectLayout(src.entries)).toBeNull()
    src.close()
  })

  it('keeps a Ren\'Py 6 game\'s own archived theme picture over the one its download ships', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpa-common-'))
    const zip = await zipOf({
      'OldGame-1.0-pc/game/script.rpyc': Buffer.from('script'),
      'OldGame-1.0-pc/game/images.rpa': buildRpa({ '_theme_glow/g_box.png': Buffer.from('own, archived') }),
      'OldGame-1.0-pc/common/_theme_glow/g_box.png': Buffer.from('shipped'),
      'OldGame-1.0-pc/common/_theme_glow/g_frame.png': Buffer.from('shipped frame'),
    }, false)
    const src = await openZip(zip)
    const assets = new PackWriter(join(dir, 'assets.pack'))
    const packed = new PackWriter(join(dir, 'zip.pack'))
    const process = vi.spyOn(ImageProcessor.prototype, 'process').mockImplementation(async (data) => ({ data, changed: false, placeholder: null }))
    const ctx: JobContext = { id: 'test', params: {}, signal: new AbortController().signal, progress() {}, log() {}, checkAbort() {} }
    try {
      await extractProject(src, 'OldGame-1.0-pc/', dir, defaultImagePolicy(), 4, ctx, [], { assets, zip: packed, skip: new Set() })
      await Promise.all([assets.close(), packed.close()])
      const read = (name: string) => {
        const [pack, at] = packed.index.has(name) ? [packed, packed.index.get(name)!] : [assets, assets.index.get(name)!]
        return readFileSync(pack.path).subarray(at[0], at[0] + at[1]).toString()
      }
      expect([read('_theme_glow/g_box.png'), read('_theme_glow/g_frame.png')]).toEqual(['own, archived', 'shipped frame'])
    } finally {
      process.mockRestore()
      src.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

