import { Router } from 'express'
import type { Catalog } from '../catalog.js'
import type { ContentMode } from '../content.js'
import { HttpError } from '../util/paths.js'

export function createContentRouter(content: ContentMode, catalog: Catalog): Router {
  const router = Router()
  const state = () => ({ adultGames: content.adultGames, locked: content.locked, chosen: content.chosen })

  router.get('/', (_req, res) => {
    res.json(state())
  })

  router.put('/', async (req, res) => {
    const mode = req.body?.adultGames
    if (mode !== 'allow' && mode !== 'block') throw new HttpError(400, 'adultGames must be "allow" or "block"')
    content.set(mode)
    await catalog.modeChanged()
    res.json(state())
  })

  return router
}
