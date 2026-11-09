import { randomBytes, timingSafeEqual } from 'node:crypto'
import { endianness } from 'node:os'

/*
 * libhydrogen's secretbox (Gimli based), as Ren'Py's renpy.encryption uses it for Ren'Py Sync:
 * message id 0 and the context "shirocat". A straight port of libhydrogen's impl/secretbox.h and
 * gimli-core/portable.h, checked against Ren'Py's own engine (the test vectors in sync.test.ts).
 */

const RATE = 16
const TAG_HEADER = 0x01
const TAG_PAYLOAD = 0x02
const TAG_FINAL = 0x08
const TAG_FINAL0 = 0xf8
const TAG_KEY0 = 0xfe
const TAG_KEY = 0xff
const DOMAIN_AEAD = 0x0
const DOMAIN_XOF = 0xf
const IV_BYTES = 20
const MAC_BYTES = 16
const HEADER_BYTES = IV_BYTES + MAC_BYTES
const PREFIX = [6, 0x73, 0x62, 0x78, 0x32, 0x35, 0x36, 8] // 6 "sbx256" 8
const RENPY_CONTEXT = Buffer.from('shirocat')

// The state is read as little-endian words in place, as libhydrogen does on such machines.
if (endianness() !== 'LE') throw new Error('Ren’Py Sync needs a little-endian machine')

class Gimli {
  readonly words = new Uint32Array(12)
  readonly bytes = new Uint8Array(this.words.buffer)

  permute(tag: number): void {
    this.bytes[47]! ^= tag
    const s = this.words
    for (let round = 24; round > 0; round--) {
      for (let c = 0; c < 4; c++) {
        const a = s[c]!, b = s[4 + c]!
        const x = (a << 24) | (a >>> 8)
        const y = (b << 9) | (b >>> 23)
        const z = s[8 + c]!
        s[8 + c] = x ^ (z << 1) ^ ((y & z) << 2)
        s[4 + c] = y ^ x ^ ((x | z) << 1)
        s[c] = z ^ y ^ ((x & y) << 3)
      }
      if ((round & 3) === 0) {
        let t = s[0]!
        s[0] = s[1]!
        s[1] = t
        t = s[2]!
        s[2] = s[3]!
        s[3] = t
        s[0] = s[0]! ^ ((0x9e377900 | round) >>> 0)
      } else if ((round & 3) === 2) {
        let t = s[0]!
        s[0] = s[2]!
        s[2] = t
        t = s[1]!
        s[1] = s[3]!
        s[3] = t
      }
    }
  }

  xor(at: number, src: Uint8Array, from = 0, length = src.length - from): void {
    for (let i = 0; i < length; i++) this.bytes[at + i]! ^= src[from + i]!
  }

  pad(pos: number, domain: number): void {
    this.bytes[pos]! ^= (domain << 1) | 1
    this.bytes[RATE - 1]! ^= 0x80
  }
}

function setup(g: Gimli, ctx: Uint8Array, key: Uint8Array, iv: Uint8Array, keyTag: number): void {
  g.bytes.fill(0)
  g.bytes.set(PREFIX, 0)
  g.bytes.set(ctx.subarray(0, 8), PREFIX.length)
  g.permute(TAG_HEADER)
  g.xor(0, key, 0, RATE)
  g.permute(keyTag)
  g.xor(0, key, RATE, RATE)
  g.permute(keyTag)
  g.bytes[0]! ^= IV_BYTES
  g.xor(1, iv, 0, RATE - 1)
  g.permute(TAG_HEADER)
  g.xor(0, iv, RATE - 1, IV_BYTES - (RATE - 1))
  // The message id, 0, xored in little-endian at IV_BYTES - RATE: nothing to do.
  g.permute(TAG_HEADER)
}

function final(g: Gimli, key: Uint8Array, tag: number): void {
  g.xor(RATE, key)
  g.permute(tag)
  g.xor(RATE, key)
  g.permute(tag)
}

export function secretboxEncrypt(message: Uint8Array, key: Uint8Array, ctx: Uint8Array = RENPY_CONTEXT, iv: Uint8Array = randomBytes(IV_BYTES)): Buffer {
  if (key.length !== 32) throw new Error('The key must be 32 bytes')
  const out = Buffer.alloc(HEADER_BYTES + message.length)
  const g = new Gimli()
  const blocks = Math.floor(message.length / RATE)
  const leftover = message.length % RATE
  // First pass: the synthetic IV.
  setup(g, ctx, key, iv, TAG_KEY0)
  for (let i = 0; i < blocks; i++) {
    g.xor(0, message, i * RATE, RATE)
    g.permute(TAG_PAYLOAD)
  }
  if (leftover) g.xor(0, message, blocks * RATE, leftover)
  g.pad(leftover, DOMAIN_XOF)
  g.permute(TAG_PAYLOAD)
  final(g, key, TAG_FINAL0)
  const siv = g.bytes.slice(RATE, RATE + IV_BYTES)
  out.set(siv, 0)
  // Second pass: encrypt, then the MAC.
  setup(g, ctx, key, siv, TAG_KEY)
  const ct = HEADER_BYTES
  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < RATE; j++) out[ct + i * RATE + j] = message[i * RATE + j]! ^ g.bytes[j]!
    g.bytes.set(out.subarray(ct + i * RATE, ct + (i + 1) * RATE), 0)
    g.permute(TAG_PAYLOAD)
  }
  if (leftover) {
    for (let j = 0; j < leftover; j++) out[ct + blocks * RATE + j] = message[blocks * RATE + j]! ^ g.bytes[j]!
    g.bytes.set(out.subarray(ct + blocks * RATE, ct + blocks * RATE + leftover), 0)
  }
  g.pad(leftover, DOMAIN_AEAD)
  g.permute(TAG_PAYLOAD)
  final(g, key, TAG_FINAL)
  out.set(g.bytes.subarray(RATE, RATE + MAC_BYTES), IV_BYTES)
  return out
}

/** Decrypts, or throws when the key is wrong or the data was changed. */
export function secretboxDecrypt(box: Uint8Array, key: Uint8Array, ctx: Uint8Array = RENPY_CONTEXT): Buffer {
  if (key.length !== 32) throw new Error('The key must be 32 bytes')
  if (box.length < HEADER_BYTES) throw new Error('Decryption failed')
  const length = box.length - HEADER_BYTES
  const out = Buffer.alloc(length)
  const g = new Gimli()
  setup(g, ctx, key, box.subarray(0, IV_BYTES), TAG_KEY)
  const blocks = Math.floor(length / RATE)
  const leftover = length % RATE
  const ct = HEADER_BYTES
  for (let i = 0; i < blocks; i++) {
    for (let j = 0; j < RATE; j++) out[i * RATE + j] = box[ct + i * RATE + j]! ^ g.bytes[j]!
    g.bytes.set(box.subarray(ct + i * RATE, ct + (i + 1) * RATE), 0)
    g.permute(TAG_PAYLOAD)
  }
  if (leftover) {
    for (let j = 0; j < leftover; j++) out[blocks * RATE + j] = box[ct + blocks * RATE + j]! ^ g.bytes[j]!
    g.bytes.set(box.subarray(ct + blocks * RATE, ct + blocks * RATE + leftover), 0)
  }
  g.pad(leftover, DOMAIN_AEAD)
  g.permute(TAG_PAYLOAD)
  final(g, key, TAG_FINAL)
  if (!timingSafeEqual(Buffer.from(g.bytes.subarray(RATE, RATE + MAC_BYTES)), Buffer.from(box.subarray(IV_BYTES, HEADER_BYTES)))) {
    out.fill(0)
    throw new Error('Decryption failed')
  }
  return out
}
