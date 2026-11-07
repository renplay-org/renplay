import { Router } from 'express'
import { viewer } from '../accounts-context.js'
import type { Catalog } from '../catalog.js'
import type { Config } from '../config.js'
import { parseAdultLevel, type ContentMode } from '../content.js'
import { HttpError } from '../util/paths.js'

export function createContentRouter(cfg: Config, content: ContentMode, catalog: Catalog): Router {
  const router = Router({ caseSensitive: true, strict: true })
  const state = () => {
    const installation = { level: content.level, fixed: content.locked, chosen: content.chosen, variable: 'RENPLAY_ADULT_GAMES' }
    // The starting level and the sign-in groups are the operator's setup: admins only.
    if (viewer()?.user.role !== 'admin') return { installation }
    return {
      installation,
      starting: { level: cfg.adultDefault, variable: 'RENPLAY_ADULT_DEFAULT' },
      groups: {
        oidc: cfg.oidcAdultGroups ? { variable: cfg.oidcAdultGroupsVariable, map: cfg.oidcAdultGroups } : null,
        ldap: cfg.ldapAdultGroups
          ? { variable: 'RENPLAY_LDAP_ADULT_GROUPS', map: cfg.ldapAdultGroups }
          : cfg.ldapAdultFilter
            ? { variable: 'RENPLAY_LDAP_ADULT_FILTER', map: null }
            : null,
      },
    }
  }

  router.get('/', (_req, res) => {
    res.json(state())
  })

  router.put('/', async (req, res) => {
    const level = parseAdultLevel(req.body?.level)
    if (!level) throw new HttpError(400, 'level must be "off", "blurred" or "shown"')
    content.set(level)
    await catalog.modeChanged()
    res.json(state())
  })

  return router
}
