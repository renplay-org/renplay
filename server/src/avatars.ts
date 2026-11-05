import { createHash, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns'
import { request } from 'node:https'
import { isIP } from 'node:net'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { HttpError } from './util/paths.js'

export const AVATAR_LIMIT = 2 << 20
/** No private, loopback, link-local, multicast or IPv4-mapped addresses in provider pictures. */
export function publicAvatarAddress(ip: string): boolean {
  if (ip.includes(':')) return /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:(?:0:|db8:)/i.test(ip)
  const p = ip.split('.').map(Number)
  return p.length === 4 && ![0, 10, 127].includes(p[0]!) && p[0]! < 224 && !(p[0] === 169 && p[1] === 254) && !(p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) && !(p[0] === 192 && [0, 168].includes(p[1]!)) && !(p[0] === 100 && p[1]! >= 64 && p[1]! <= 127) && !(p[0] === 198 && [18, 19].includes(p[1]!))
}
export async function fetchAvatar(value: string): Promise<Buffer> {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Avatar pictures require HTTPS on port 443')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !publicAvatarAddress(host)) throw new Error('Private avatar address')
  return new Promise((resolve, reject) => {
    const req = request(url, { timeout: 5000, signal: AbortSignal.timeout(5000), lookup: (host, options, callback) => {
      lookup(host, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error, [])
        if (!addresses.length || addresses.some(a => !publicAvatarAddress(a.address))) return callback(new Error('Private avatar address'), [])
        if (options.all) callback(null, addresses)
        else callback(null, addresses[0]!.address, addresses[0]!.family)
      })
    } }, res => {
      if (res.statusCode !== 200 || !/^image\/(jpeg|png|webp)(?:;|$)/i.test(res.headers['content-type'] ?? '') || Number(res.headers['content-length'] ?? 0) > AVATAR_LIMIT) { res.resume(); reject(new Error('Unsupported avatar response')); return }
      const chunks: Buffer[] = []; let size = 0
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > AVATAR_LIMIT) req.destroy(new Error('Avatar is too large')); else chunks.push(chunk) })
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Avatar timed out')))
    req.on('error', reject); req.end()
  })
}
export async function storeAvatar(dataDir: string, data: Buffer): Promise<string> {
  if (!data.length || data.length > AVATAR_LIMIT) throw new HttpError(413, 'Use a picture smaller than 2 MiB')
  let webp: Buffer
  try {
    const image = sharp(data, { limitInputPixels: 16_000_000, animated: false })
    const meta = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '')) throw new Error('Unsupported type')
    webp = await image.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer()
  } catch { throw new HttpError(400, 'Use a JPEG, PNG or WebP picture up to 16 megapixels') }
  const filename = createHash('sha256').update(webp).digest('hex') + '.webp'
  await mkdir(join(dataDir, 'avatars'), { recursive: true })
  const temporary = join(dataDir, 'avatars', `.${filename}.${randomBytes(8).toString('hex')}.tmp`)
  try {
    await writeFile(temporary, webp, { flag: 'wx' })
    await rename(temporary, join(dataDir, 'avatars', filename))
  } finally { await rm(temporary, { force: true }) }
  return filename
}
