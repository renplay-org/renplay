import { Router } from 'express'
import type { GameRow, GameWithProgress } from '../db.js'
import type { Services } from '../services.js'

interface SessionRow {
  game: string
  started_at: number
  ended_at: number
  seconds: number
}

/** The local calendar day of a moment, as YYYY-MM-DD (the server's time zone, TZ). */
/** The day of a time, in the person's own time zone when the browser sends it (else the server's). */
function dayFormat(tz: unknown): (ms: number) => string {
  let format: Intl.DateTimeFormat | null = null
  if (typeof tz === 'string' && tz.length <= 64) {
    try {
      format = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    } catch {}
  }
  return (ms) => {
    if (format) return format.format(ms)
    const d = new Date(ms)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}

/**
 * Play history (DESIGN round 2, 4.7): the person's totals, their sessions by day, and the time
 * per game with ratings and statuses. Only games in the library that the person may see count:
 * a hidden game's sessions stay stored and come back with the level.
 */
export function createHistoryRouter(s: Services): Router {
  const { db, catalog, accounts } = s
  const router = Router({ caseSensitive: true, strict: true })

  router.get('/', (req, res) => {
    const user = accounts.current().id
    const dayOf = dayFormat(req.query['tz'])
    const days = Math.max(1, Math.min(90, Number.parseInt(String(req.query['days'] ?? '14'), 10) || 14))
    const before = Number.parseInt(String(req.query['before'] ?? ''), 10)
    const visible = new Map<string, GameWithProgress>()
    const seen = (id: string): GameWithProgress | null => {
      if (visible.has(id)) return visible.get(id)!
      const row = db.getGame(id)
      if (!row || catalog.content.hides(row)) return null
      const withProgress = accounts.progress(row)
      visible.set(id, withProgress)
      return withProgress
    }
    // ?game= narrows the history to one game, for its game page.
    const only = typeof req.query['game'] === 'string' ? req.query['game'] : null
    const all = (db.raw.prepare('SELECT game, started_at, ended_at, seconds FROM play_sessions WHERE user_id = ? ORDER BY ended_at DESC').all(user) as unknown as SessionRow[]).filter((s) => (!only || s.game === only) && seen(s.game))
    const title = (row: GameRow) => (row.recipe_id ? catalog.recipe(row.recipe_id)?.title : undefined) ?? row.title
    const icon = (row: GameRow) => catalog.gameArt(row).icon ?? null

    // Whole days, newest first, starting before the cursor.
    const inRange = Number.isFinite(before) ? all.filter((s) => s.started_at < before) : all
    const dayKeys: string[] = []
    for (const s of inRange) {
      const key = dayOf(s.started_at)
      if (!dayKeys.includes(key)) dayKeys.push(key)
      if (dayKeys.length > days) break
    }
    const shown = dayKeys.slice(0, days)
    const page = inRange.filter((s) => shown.includes(dayOf(s.started_at)))
    const oldest = page.length ? Math.min(...page.map((s) => s.started_at)) : null

    const perGame = new Map<string, { seconds: number; sessions: number; last: number }>()
    for (const s of all) {
      const g = perGame.get(s.game) ?? { seconds: 0, sessions: 0, last: 0 }
      g.seconds += s.seconds
      g.sessions += 1
      g.last = Math.max(g.last, s.ended_at)
      perGame.set(s.game, g)
    }

    res.json({
      totals: {
        seconds: all.reduce((n, s) => n + s.seconds, 0),
        sessions: all.length,
        games: perGame.size,
        since: all.length ? Math.min(...all.map((s) => s.started_at)) : null,
      },
      days: shown.map((day) => {
        const sessions = page.filter((s) => dayOf(s.started_at) === day)
        return {
          day,
          seconds: sessions.reduce((n, s) => n + s.seconds, 0),
          sessions: sessions.map((s) => {
            const row = visible.get(s.game)!
            return { game: s.game, title: title(row), nsfw: row.adult === 1, startedAt: s.started_at, endedAt: s.ended_at, seconds: s.seconds, icon: icon(row) }
          }),
        }
      }),
      games: [...perGame.entries()]
        .sort((a, b) => b[1].seconds - a[1].seconds)
        .map(([id, g]) => {
          const row = visible.get(id)!
          return { id, title: title(row), nsfw: row.adult === 1, seconds: g.seconds, sessions: g.sessions, lastPlayedAt: g.last, rating: row.rating || null, playStatus: row.play_status || null, icon: icon(row) }
        }),
      next: oldest !== null && inRange.some((s) => s.started_at < oldest && !shown.includes(dayOf(s.started_at))) ? oldest : null,
    })
  })

  return router
}
