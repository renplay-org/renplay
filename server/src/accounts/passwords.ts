import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { HttpError } from '../util/paths.js'

// Measured locally at 207 ms (N=65536: 105 ms); explicit 128 MiB work factor.
export const PASSWORD_PREFIX = 'scrypt$1$131072$8$1$'
const scrypt = (password: string, salt: string, N: number) => new Promise<Buffer>((resolve, reject) => {
  scryptCallback(password, salt, 64, { N, r: 8, p: 1, maxmem: 256 << 20 }, (error, key) => error ? reject(error) : resolve(key))
})
export const hash = (s: string) => createHash('sha256').update(s).digest('hex')
export const random = () => randomBytes(32).toString('base64url')

export async function passwordHash(password: unknown): Promise<string> {
  if (typeof password !== 'string' || password.length < 10 || password.length > 1024) throw new HttpError(400, 'Use a password with 10 to 1024 characters')
  return secretHash(password)
}
/** A password or PIN as stored: scrypt with its own salt, checked by passwordMatches. */
export async function secretHash(secret: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  return `${PASSWORD_PREFIX}${salt}$${(await scrypt(secret, salt, 131072)).toString('hex')}`
}
export async function passwordMatches(password: unknown, encoded: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 1024) return false
  const parts = encoded.split('$')
  const [salt, key] = parts.length === 1 ? encoded.split(':') : parts.slice(5)
  const N = parts.length === 1 ? 16384 : Number(parts[2])
  if (parts.length !== 1 && (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== '1' || parts[3] !== '8' || parts[4] !== '1' || ![16384, 65536, 131072].includes(N))) return false
  if (!salt || !key || !/^[0-9a-f]{128}$/.test(key)) return false
  const actual = await scrypt(password, salt, N)
  const expected = Buffer.from(key, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export function equal(a: string, b: string): boolean { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))) }
