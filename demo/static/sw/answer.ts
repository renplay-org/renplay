/*
 * The demo's stand-in for the server: answers /api/ from a snapshot of the demo (made at build time), and keeps the
 * visitor's saves and progress in the store it is given. Only what playing needs is answered. Everything else is refused
 * with the words the server uses for the demo's guest (shared/demo-refusals.ts).
 */
import type { GamesResponse } from '../../../server/src/shared/api'
import { DEMO_REFUSAL, demoStaticRefuses } from '../../../server/src/shared/demo-refusals'
import { SNAPSHOT_ROUTES } from '../snapshot-routes.mjs'
import { Refusal, fail, json } from './http'
import { gameRoute, history, project } from './progress'
import { savesRoute } from './saves'
import type { Env } from './types'

const GAME_ID = '[a-z0-9][a-z0-9._-]*'

/** What a request the stand-in has no answer for is told. A write never gets here: the refusal list has it before. */
const unanswered = (method: string) => (method === 'GET' || method === 'HEAD' ? fail(404, 'Not found') : fail(403, DEMO_REFUSAL))

export function createAnswer(env: Env): (req: Request) => Promise<Response> {
  async function route(req: Request, url: URL): Promise<Response> {
    const s = await env.snapshot()
    const path = url.pathname
    const m = req.method
    const read = m === 'GET' || m === 'HEAD'
    const body = async () => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
    if (demoStaticRefuses(m, path)) return fail(403, DEMO_REFUSAL)

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
      // The runtime sends the compiled caches of a build after a first start. The server keeps them for an admin and
      // refuses the guest with a 403. Here the upload is taken and dropped, so no request of the demo fails.
      if (game[2] === '/cache' && m === 'PUT') return json({ ok: true })
      return (await gameRoute(env, req, g, game[2] ?? '', body)) ?? unanswered(m)
    }
    const saves = new RegExp(`^/api/saves/(${GAME_ID})(/.*)?$`).exec(path)
    if (saves) {
      const g = s.games.find((x) => x.id === saves[1])
      if (!g) return fail(404, 'Game not found')
      return (await savesRoute(env, req, url, g, saves[2] ?? '')) ?? unanswered(m)
    }
    return unanswered(m)
  }
  return (req) => route(req, new URL(req.url)).catch((e: unknown) => (e instanceof Refusal ? fail(e.status, e.message) : fail(500, e instanceof Error ? e.message : 'Something went wrong')))
}
