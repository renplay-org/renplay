import type { Request } from 'express'
import { HttpError } from '../util/paths.js'

/** A closed player allowlist makes new management endpoints admin-only by default. */
export function playerRoute(method: string, path: string): boolean {
  if (/^\/api\/me(?:\/|$)/.test(path) || /^\/api\/avatars\/[a-f0-9]{64}\.webp$/.test(path) && ['GET', 'HEAD'].includes(method)) return true
  if (/^\/api\/saves(?:\/|$)/.test(path) || path === '/api/saves-export' || path === '/api/saves-import') return true
  if ((method === 'GET' || method === 'HEAD') && (/^\/g\//.test(path) || /^\/api\/(art|walkthroughs)\//.test(path) || ['/api/games', '/api/catalog', '/api/content'].includes(path) || /^\/api\/games\/[^/]+(?:\/art|\/offline)?$/.test(path))) return true
  // A player chooses and uploads art for their own view (the route refuses everyone).
  if ((method === 'GET' || method === 'HEAD') && (path === '/api/history' || path === '/api/widget' || path === '/api/defaults')) return true
  return /^(PUT \/api\/games\/[^/]+\/(favorite|art|status|rating)|POST \/api\/games\/[^/]+\/(played|play-time|art\/upload|not-now)|DELETE \/api\/games\/[^/]+\/(art|not-now|art\/uploads\/[0-9a-f]{64}))$/.test(`${method} ${path}`)
}

/**
 * What the demo's guest may not do, on top of a player's limits: anything that changes the shared
 * account or adds files to the server. Everything a visitor tries goes at the next restart anyway.
 */
const DEMO_REFUSED: Array<[method: string, path: RegExp]> = [
  ['PUT', /^\/api\/me$/],
  ['POST', /^\/api\/me\/(password|avatar|tokens|claim-owner)$/],
  ['PUT', /^\/api\/me\/pin$/],
  ['DELETE', /^\/api\/me\/(tokens|sessions)(\/.*)?$/],
  // The shared account's sessions are other visitors' browsers.
  ['GET', /^\/api\/me\/sessions$/],
  ['*', /^\/api\/me\/identities(\/.*)?$/],
  ['POST', /^\/api\/games\/[^/]+\/art\/upload$/],
  ['DELETE', /^\/api\/games\/[^/]+\/art\/uploads\/.+$/],
  ['POST', /^\/api\/saves-import$/],
  // Choices everyone shares, since everyone is the same guest.
  ['PUT', /^\/api\/me\/(tags|adult)$/],
]
/** The guest's save writes: a game's own saving, a save's name and note, deleting one, restoring one. */
const DEMO_SAVE_WRITES = /^\/api\/saves\/[^/]+\/(file|meta|slot|history\/restore)$/
export function demoCheck(req: Request): void {
  const refused = DEMO_REFUSED.some(([m, p]) => (m === '*' || m === req.method) && p.test(req.path))
  // Imports, copies, Sync codes and the save folder are not among them: they bring in files or change the game for everyone.
  const saveWrite = req.method !== 'GET' && req.method !== 'HEAD' && /^\/api\/saves\//.test(req.path) && !DEMO_SAVE_WRITES.test(req.path)
  if (refused || saveWrite) throw new HttpError(403, 'The demo cannot do this. Install your own Renplay to try it.')
}
