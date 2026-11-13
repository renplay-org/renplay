import type { PackReader } from '../pipeline/pack.js'

/**
 * RPG Maker MV and MZ games can ship their pictures and sounds encrypted (img/x.rpgmvp in MV,
 * img/x.png_ in MZ): a 16-byte header, then the file with its first 16 bytes XORed with the
 * game's key (data/System.json, encryptionKey). The engine decrypts them itself, but some plugins
 * load the plain name (a preloader asking for img/pictures/x.png), which then fails and leaves a
 * broken picture in the engine's cache. Those names get the decrypted file.
 */
const ENCRYPTED: Record<string, string[]> = { png: ['rpgmvp', 'png_'], ogg: ['rpgmvo', 'ogg_'], m4a: ['rpgmvm', 'm4a_'] }
const HEADER = Buffer.from('RPGMV')
const keys = new Map<string, Buffer | null>()

async function keyOf(reader: PackReader): Promise<Buffer | null> {
  if (keys.has(reader.packPath)) return keys.get(reader.packPath)!
  let key: Buffer | null = null
  try {
    const system = JSON.parse((await reader.read('data/System.json'))?.toString('utf-8') ?? '{}') as { encryptionKey?: unknown }
    if (typeof system.encryptionKey === 'string' && /^[0-9a-f]{32}$/i.test(system.encryptionKey)) key = Buffer.from(system.encryptionKey, 'hex')
  } catch {}
  keys.set(reader.packPath, key)
  while (keys.size > 20) keys.delete(keys.keys().next().value!)
  return key
}

/** The plain file for a name the build only has encrypted, or null. */
export async function decryptedRpgMaker(reader: PackReader, name: string): Promise<Buffer | null> {
  const m = /^(.*)\.(png|ogg|m4a)$/i.exec(name)
  if (!m) return null
  let encrypted: Buffer | null = null
  for (const ext of ENCRYPTED[m[2]!.toLowerCase()]!) {
    encrypted = await reader.read(`${m[1]}.${ext}`)
    if (encrypted) break
  }
  if (!encrypted || encrypted.length <= 16 || !encrypted.subarray(0, 5).equals(HEADER)) return null
  const key = await keyOf(reader)
  if (!key) return null
  const plain = Buffer.from(encrypted.subarray(16))
  for (let i = 0; i < 16 && i < plain.length; i++) plain[i]! ^= key[i]!
  return plain
}
