import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { openZip } from '../pipeline/archive.js'
import { detectLayout } from '../pipeline/project.js'
import { readRpaIndex, splitRpa } from '../pipeline/rpa.js'

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

  it('detects prebuilt web builds', async () => {
    const zip = await zipOf({ 'x/index.html': Buffer.from('<html>'), 'x/game.zip': Buffer.from('PK'), 'x/renpy.wasm': Buffer.from('w') }, true)
    const src = await openZip(zip)
    expect(detectLayout(src.entries)).toEqual({ kind: 'web', root: 'x/' })
    src.close()
  })

  it('ignores archives without a Ren\'Py game', async () => {
    const zip = await zipOf({ 'readme.txt': Buffer.from('hi') }, true)
    const src = await openZip(zip)
    expect(detectLayout(src.entries)).toBeNull()
    src.close()
  })
})

