import { Router } from 'express'
import type { Services } from '../services.js'
import { HttpError } from '../util/paths.js'

/** What players report about a session of play, and the admin's switch for the usage report. */
export function createTelemetryRouter(s: Services): Router {
  const { db, content, telemetry } = s
  const router = Router({ caseSensitive: true, strict: true })

  // The player says once per session how it went. It is counted by device and browser, and by game
  // only when the game is in the catalog. Off, it is answered and dropped.
  router.post('/telemetry/client', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const game = typeof body.game === 'string' ? db.getGame(body.game) : null
    telemetry.client(body, game && !content.hides(game) ? game : null)
    res.status(204).end()
  })

  router.put('/system/telemetry', (req, res) => {
    if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'Expected { on: true or false }')
    telemetry.set(req.body.on)
    res.json(telemetry.status())
  })

  return router
}
