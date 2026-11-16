/*
 * The demo's stand-in for the server: answers /api/ from a snapshot of the demo (made at build time), and keeps the
 * visitor's saves and progress in the store it is given. Only what the demo uses is answered. Everything else is refused
 * the way the server refuses the demo's guest (shared/demo-refusals.ts).
 */
import type { GamesResponse } from '../../../server/src/shared/api'
import { DEMO_REFUSAL, demoRefuses } from '../../../server/src/shared/demo-refusals'
import { SNAPSHOT_ROUTES } from '../snapshot-routes.mjs'
import { Refusal, fail, json } from './http'
import { gameRoute, history, project } from './progress'
import { savesRoute } from './saves'
import type { Env } from './types'

const GAME_ID = '[a-z0-9][a-z0-9._-]*'

/** What a request the stand-in has no answer for is told. */
const unanswered = (method: string, path: string) => {
  if (method === 'GET' || method === 'HEAD') return fail(404, 'Not found')
  return fail(403, demoRefuses(method, path) ? DEMO_REFUSAL : 'Only an admin can do this')
}

export function createAnswer(env: Env): (req: Request) => Promise<Response> {
  async function route(req: Request, url: URL): Promise<Response> {
    const s = await env.snapshot()
    const path = url.pathname
    const m = req.method
    const read = m === 'GET' || m === 'HEAD'
    const body = async () => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    if (demoRefuses(m, path)) return fail(403, DEMO_REFUSAL)

    if (path === '/api/me' && read) return json(s.me)
    if (read && SNAPSHOT_ROUTES.includes(path)) return json(s.routes[path])
    if (path === '/api/auth/demo' && m === 'POST') return json({ ok: true })
    if (path === '/api/telemetry/client' && m === 'POST') return new Response(null, { status: 204 })
    if (path === '/api/history' && read) return json(await history(env, url, s.games))
    if (path === '/api/games' && read) return json({ games: await Promise.all(s.games.map((g) => project(env, g))) } satisfies GamesResponse)
    const game = new RegExp(`^/api/games/(${GAME_ID})(/.*)?$`).exec(path)
    if (game) {
      const g = s.games.find((x) => x.id === game[1])
      if (!g) return fail(404, 'Game not found')
      return (await gameRoute(env, req, g, game[2] ?? '', body)) ?? unanswered(m, path)
    }
    const saves = new RegExp(`^/api/saves/(${GAME_ID})(/.*)?$`).exec(path)
    if (saves) {
      const g = s.games.find((x) => x.id === saves[1])
      if (!g) return fail(404, 'Game not found')
      return (await savesRoute(env, req, url, g, saves[2] ?? '')) ?? unanswered(m, path)
    }
    return unanswered(m, path)
  }
  return (req) => route(req, new URL(req.url)).catch((e: unknown) => (e instanceof Refusal ? fail(e.status, e.message) : fail(500, e instanceof Error ? e.message : 'Something went wrong')))
}
