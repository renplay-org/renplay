import { Router } from 'express'
import type { GameRow } from '../db.js'
import { toGame } from '../games/routes.js'
import type { Services } from '../services.js'
import { HttpError } from '../util/paths.js'
import { PLAY_STATUSES, type GameWithProgress } from './store.js'

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

/** A person's progress with each game, and their play history. */
export function createProgressRouter(s: Services): Router {
  const { db, catalog, accounts, content, progress } = s
  const router = Router({ caseSensitive: true, strict: true })
  const me = () => accounts.current().id
  /** The changed game, as the library shows it. */
  const answer = async (g: GameRow) => ({ ok: true, game: await toGame(db.getGame(g.id)!, s) })

  router.put('/games/:id/favorite', async (req, res) => {
    const g = content.game(req.params.id)
    if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'On must be a boolean')
    progress.setFavorite(me(), g, req.body.on)
    res.json(await answer(g))
  })

  router.put('/games/:id/status', async (req, res) => {
    const g = content.game(req.params.id)
    const status = req.body?.status ?? ''
    if (!PLAY_STATUSES.includes(status)) throw new HttpError(400, 'Status must be playing, stalled, dropped, finished or empty')
    progress.setStatus(me(), g, status)
    res.json(await answer(g))
  })

  router.put('/games/:id/rating', async (req, res) => {
    const g = content.game(req.params.id)
    const rating = req.body?.rating ?? 0
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new HttpError(400, 'Rating must be a whole number from 0 to 5')
    progress.set(me(), g.id, { rating })
    res.json(await answer(g))
  })

  // Not now: the game leaves Up next until it is played again. DELETE undoes it.
  router.post('/games/:id/not-now', async (req, res) => {
    const g = content.game(req.params.id)
    progress.set(me(), g.id, { not_now_at: new Date().toISOString() })
    res.json(await answer(g))
  })
  router.delete('/games/:id/not-now', async (req, res) => {
    const g = content.game(req.params.id)
    progress.set(me(), g.id, { not_now_at: '' })
    res.json(await answer(g))
  })

  // The player reports visible, running time in seconds, in bounded increments.
  router.post('/games/:id/play-time', (req, res) => {
    const g = content.game(req.params.id)
    const seconds = req.body?.seconds
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new HttpError(400, 'Seconds must be an integer from 1 to 60')
    progress.addPlayTime(me(), g, seconds)
    res.json({ ok: true })
  })

  router.post('/games/:id/played', (req, res) => {
    progress.set(me(), content.game(req.params.id).id, { last_played_at: new Date().toISOString() })
    res.json({ ok: true })
  })

  /**
   * Play history: the person's totals, their sessions by day, and the time per game with ratings
   * and statuses. Only games in the library that the person may see count: a hidden game's
   * sessions stay stored and come back with the level.
   */
  router.get('/history', (req, res) => {
    const user = me()
    const dayOf = dayFormat(req.query['tz'])
    const days = Math.max(1, Math.min(90, Number.parseInt(String(req.query['days'] ?? '14'), 10) || 14))
    const before = Number.parseInt(String(req.query['before'] ?? ''), 10)
    const visible = new Map<string, GameWithProgress>()
    const seen = (id: string): GameWithProgress | null => {
      if (visible.has(id)) return visible.get(id)!
      const row = db.getGame(id)
      if (!row || content.hides(row)) return null
      const withProgress = progress.of(user, row)
      visible.set(id, withProgress)
      return withProgress
    }
    // ?game= narrows the history to one game, for its game page.
    const only = typeof req.query['game'] === 'string' ? req.query['game'] : null
    const all = progress.sessions(user).filter((s) => (!only || s.game === only) && seen(s.game))
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
