import { Router } from 'express'
import type { Services } from '../services.js'
import { HttpError } from '../util/paths.js'
import { DEFAULTS_KEY, readDefaults, type Defaults } from './defaults.js'

/** The defaults for everyone: anyone may read them, an admin sets them. */
export function createDefaultsRouter(s: Services): Router {
  const { db } = s
  const router = Router({ caseSensitive: true, strict: true })

  router.get('/defaults', (_req, res) => {
    res.json(readDefaults(db))
  })

  router.put('/defaults', (req, res) => {
    const b = req.body ?? {}
    const bool = (v: unknown, name: string) => {
      if (v === null || v === undefined) return null
      if (typeof v !== 'boolean') throw new HttpError(400, `${name} is true, false or empty`)
      return v
    }
    if (b.tagsExclude !== undefined && (!Array.isArray(b.tagsExclude) || b.tagsExclude.length > 60 || b.tagsExclude.some((t: unknown) => typeof t !== 'string' || !/^[a-z0-9-]{1,40}$/.test(t))))
      throw new HttpError(400, 'Tags are a list of tag ids')
    if (b.textSize !== undefined && b.textSize !== null && ![1, 1.25, 1.5].includes(b.textSize)) throw new HttpError(400, 'Text size is 1, 1.25, 1.5 or empty')
    const next: Defaults = {
      tagsExclude: [...new Set<string>(b.tagsExclude ?? [])],
      lighterBackground: bool(b.lighterBackground, 'Lighter background'),
      textSize: b.textSize ?? null,
      rollback: bool(b.rollback, 'Rollback'),
      skip: bool(b.skip, 'Skip'),
    }
    db.setSetting(DEFAULTS_KEY, next)
    res.json(next)
  })

  return router
}
