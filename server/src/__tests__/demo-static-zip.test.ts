import { crc32, deflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSave } from '../../../demo/static/sw/zip'
import { renpySave } from './demo-static-fixture.js'

/*
 * A save file is read in the visitor's browser, and its zip comes from the page of a game. It is the visitor's own
 * browser memory that a hostile zip would fill, so the reading holds to the limits of the server's reader
 * (util/zip.ts): 2,048 entries, 64 MiB for an entry and for all, checked in the whole directory before anything is
 * extracted, and in the bytes that actually come out.
 */

interface Part { name: string; data: Buffer; method?: 0 | 8; declared?: number; attributes?: number }

/** A zip made by hand, so that its directory can say what a real writer never would. */
function zip(parts: Part[], count = parts.length): ArrayBuffer {
  const body: Buffer[] = [], directory: Buffer[] = []
  let offset = 0
  for (const p of parts) {
    const method = p.method ?? 8
    const packed = method === 8 ? deflateRawSync(p.data) : p.data
    const name = Buffer.from(p.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc32(p.data), 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(p.declared ?? p.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(0x031e, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt32LE(crc32(p.data), 16)
    entry.writeUInt32LE(packed.length, 20)
    entry.writeUInt32LE(p.declared ?? p.data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE((p.attributes ?? 0o100644 << 16) >>> 0, 38)
    entry.writeUInt32LE(offset, 42)
    body.push(local, name, packed)
    directory.push(entry, name)
    offset += local.length + name.length + packed.length
  }
  const dir = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  const all = Buffer.concat([...body, dir, end])
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer
}

/** Where the directory starts, and its entries' fields, for a test that damages one. */
const directoryAt = (data: ArrayBuffer) => new DataView(data).getUint32(data.byteLength - 22 + 16, true)

const text = (s: string) => Buffer.from(s)
const log = { name: 'log', data: text('log') }
const json = (o: object): Part => ({ name: 'json', data: text(JSON.stringify(o)) })
const MiB = 1 << 20

/** Counts what the browser's decompression hands out, so a test can tell how much was really made. */
function countDecompressed() {
  const counter = { bytes: 0, made: 0 }
  const Real = globalThis.DecompressionStream
  vi.stubGlobal('DecompressionStream', class {
    readable: ReadableStream<Uint8Array>
    writable: WritableStream<BufferSource>
    constructor(format: CompressionFormat) {
      counter.made++
      const real = new Real(format)
      this.writable = real.writable
      this.readable = real.readable.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { counter.bytes += chunk.byteLength; controller.enqueue(chunk) } }))
    }
  })
  return counter
}

afterEach(() => { vi.unstubAllGlobals() })

describe('reading a save in the browser', () => {
  it('reads an ordinary save, with its picture', async () => {
    const save = await renpySave('First', 1700000000)
    const data = save.buffer.slice(save.byteOffset, save.byteOffset + save.byteLength) as ArrayBuffer
    const meta = await readSave(data, true)
    expect([meta?.name, meta?.ctime, meta?.renpyVersion, meta?.hasScreenshot]).toEqual(['First', 1700000000, '8.5.3', true])
    expect(meta?.screenshot?.byteLength).toBeGreaterThan(100)
  })

  it('refuses a decompression bomb by its directory, before it decompresses a byte', async () => {
    const counter = countDecompressed()
    // 80 MiB of zeros packs to about 80 KiB, and the directory says so honestly.
    const bomb = zip([log, json({ _save_name: 'x' }), { name: 'screenshot.png', data: Buffer.alloc(80 * MiB) }])
    expect(await readSave(bomb, true)).toBeNull()
    expect(counter.made).toBe(0)
  })

  it('refuses a directory whose sizes add up past the limit, though no entry is past it', async () => {
    const counter = countDecompressed()
    const data = Buffer.alloc(40 * MiB)
    expect(await readSave(zip([log, json({}), { name: 'a', data }, { name: 'b', data }]))).toBeNull()
    expect(counter.made).toBe(0)
  })

  it('stops a decompression bomb that lies about its size, and does not buffer past the limit', async () => {
    const counter = countDecompressed()
    // The directory says 200 bytes. What is inside is 100 MiB.
    const lying = zip([log, { name: 'json', data: Buffer.alloc(100 * MiB), declared: 200 }])
    expect(await readSave(lying)).toBeNull()
    expect(counter.bytes).toBeLessThan(8 * MiB)
  })

  it('refuses an entry that is smaller than its directory says', async () => {
    expect(await readSave(zip([log, { name: 'json', data: text('{}'), declared: 9000 }]))).toBeNull()
  })

  it('refuses more entries than the server takes, and takes as many as it does', async () => {
    const many = (n: number) => zip([log, ...Array.from({ length: n - 1 }, (_, i) => ({ name: `f${i}`, data: Buffer.alloc(0), method: 0 as const }))])
    expect(await readSave(many(2049))).toBeNull()
    expect(await readSave(many(2048))).not.toBeNull()
  })

  it('refuses a directory that says more entries than it holds', async () => {
    expect(await readSave(zip([log, json({ _save_name: 'x' })], 3))).toBeNull()
  })

  it('refuses two entries of one name', async () => {
    expect(await readSave(zip([log, json({ _save_name: 'first' }), json({ _save_name: 'second' })]))).toBeNull()
  })

  it('refuses paths that leave the folder, and the same path written two ways', async () => {
    for (const name of ['../json', '/json', 'a/../json', 'C:json', 'a\\..\\json']) expect(await readSave(zip([log, { name, data: text('{}') }])), name).toBeNull()
    expect(await readSave(zip([log, { name: 'a/b', data: text('1') }, { name: 'a\\b', data: text('2') }]))).toBeNull()
  })

  it('refuses links and special files, and a method it does not read', async () => {
    expect(await readSave(zip([log, { name: 'link', data: text('x'), attributes: 0o120777 << 16 }]))).toBeNull()
    const odd = zip([log, json({ _save_name: 'x' })])
    // Method 12 (bzip2) in the directory's second entry, after the first entry's 46 bytes and its 3 of name.
    new DataView(odd).setUint16(directoryAt(odd) + 46 + 3 + 10, 12, true)
    expect(await readSave(odd)).toBeNull()
  })

  it('refuses an archive that is cut short, wherever it is cut', async () => {
    const whole = zip([log, json({ _save_name: 'x' }), { name: 'screenshot.png', data: Buffer.alloc(5000, 7) }])
    for (let cut = 0; cut < whole.byteLength; cut += 7) expect(await readSave(whole.slice(0, cut), true), `cut at ${cut}`).toBeNull()
  })

  it('refuses an archive whose entries point outside it', async () => {
    const away = zip([log, json({ _save_name: 'x' })])
    new DataView(away).setUint32(directoryAt(away) + 42, away.byteLength + 100, true)
    expect(await readSave(away)).toBeNull()
    const long = zip([log, json({ _save_name: 'x' })])
    new DataView(long).setUint32(directoryAt(long) + 20, 0x7fffffff, true)
    expect(await readSave(long)).toBeNull()
  })
})
