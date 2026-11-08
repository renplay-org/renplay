import http from 'node:http'
import https from 'node:https'
import { randomBytes } from 'node:crypto'
import type { Config } from '../config.js'

/** The token the keepalive request carries. It lives only as long as the process. */
export const keepaliveToken = randomBytes(32).toString('base64url')

/**
 * Keeps a scale-to-zero deployment awake while jobs run by holding a request
 * open through the HTTP proxy that counts in-flight requests.
 */
export function startKeepalive(cfg: Config): { stop: () => void } {
  if (!cfg.keepaliveUrl) return { stop: () => {} }
  let stopped = false
  let req: http.ClientRequest | null = null
  const loop = () => {
    if (stopped) return
    const url = new URL('/api/keepalive?hold=120', cfg.keepaliveUrl)
    const mod = url.protocol === 'https:' ? https : http
    req = mod.request(
      url,
      { method: 'GET', headers: { authorization: `Bearer ${keepaliveToken}`, ...(cfg.keepaliveHost ? { host: cfg.keepaliveHost } : {}) }, timeout: 150_000 },
      (res) => {
        res.resume()
        res.on('end', () => setTimeout(loop, 500))
      },
    )
    req.on('error', () => setTimeout(loop, 5000))
    req.on('timeout', () => req?.destroy())
    req.end()
  }
  loop()
  return {
    stop: () => {
      stopped = true
      req?.destroy()
    },
  }
}
