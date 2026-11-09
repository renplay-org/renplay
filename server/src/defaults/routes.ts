import { Router } from 'express'
import type { Services } from '../services.js'
import { HttpError } from '../util/paths.js'
import { DEFAULTS_KEY, readDefaults } from './defaults.js'
import { TEXT_SIZES, isTagIdList, type Defaults } from '../shared/defaults.js'

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
    if (b.tagsExclude !== undefined && !isTagIdList(b.tagsExclude))
      throw new HttpError(400, 'Tags are a list of tag ids')
    if (b.textSize !== undefined && b.textSize !== null && !TEXT_SIZES.some((t) => t.value === b.textSize)) throw new HttpError(400, `Text size is ${TEXT_SIZES.map((t) => t.value).join(', ')} or empty`)
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
