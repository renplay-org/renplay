import { Router } from 'express'
import { viewer } from '../accounts-context.js'
import { parseAdultLevel } from './levels.js'
import { HttpError } from '../util/paths.js'
import type { Services } from '../services.js'

/** The adult levels: the installation's, what admins see of the setup, and marking a game safe for work. */
export function createContentRouter(s: Services): Router {
  const { cfg, db, content, catalog } = s
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

  router.get('/content', (_req, res) => {
    res.json(state())
  })

  router.put('/content', async (req, res) => {
    const level = parseAdultLevel(req.body?.level)
    if (!level) throw new HttpError(400, 'level must be "off", "blurred" or "shown"')
    content.set(level)
    await catalog.modeChanged()
    res.json(state())
  })

  // Marks a game without a recipe safe for work, so people whose own level is Off see it too.
  router.post('/games/:id/safe', (req, res) => {
    const g = content.game(req.params.id)
    if (g.recipe_id) throw new HttpError(409, 'Only games without a recipe can be marked safe')
    if (typeof req.body?.safe !== 'boolean') throw new HttpError(400, 'Safe must be a boolean')
    if (req.body.safe) db.raw.prepare('INSERT OR IGNORE INTO safe_games VALUES (?)').run(g.id)
    else db.raw.prepare('DELETE FROM safe_games WHERE game = ?').run(g.id)
    res.json({ ok: true })
  })

  return router
}
