import type { Request } from 'express'
import { DEMO_REFUSAL, demoRefuses } from '../shared/demo-refusals.js'
import { HttpError } from '../util/paths.js'

/** A closed player allowlist makes new management endpoints admin-only by default. */
export function playerRoute(method: string, path: string): boolean {
  if (/^\/api\/me(?:\/|$)/.test(path) || /^\/api\/avatars\/[a-f0-9]{64}\.webp$/.test(path) && ['GET', 'HEAD'].includes(method)) return true
  if (/^\/api\/saves(?:\/|$)/.test(path) || path === '/api/saves-export' || path === '/api/saves-import') return true
  if ((method === 'GET' || method === 'HEAD') && (/^\/g\//.test(path) || /^\/api\/(art|walkthroughs)\//.test(path) || ['/api/games', '/api/catalog', '/api/content'].includes(path) || /^\/api\/games\/[^/]+(?:\/art|\/offline)?$/.test(path))) return true
  // A player chooses and uploads art for their own view (the route refuses everyone).
  if ((method === 'GET' || method === 'HEAD') && (path === '/api/history' || path === '/api/widget' || path === '/api/defaults')) return true
  return /^(PUT \/api\/games\/[^/]+\/(favorite|art|status|rating)|POST \/api\/games\/[^/]+\/(played|play-time|art\/upload|not-now)|POST \/api\/telemetry\/client|DELETE \/api\/games\/[^/]+\/(art|not-now|art\/uploads\/[0-9a-f]{64}))$/.test(`${method} ${path}`)
}

/** The demo's guest may not do what the shared list refuses. */
export function demoCheck(req: Request): void {
  if (demoRefuses(req.method, req.path)) throw new HttpError(403, DEMO_REFUSAL)
}
