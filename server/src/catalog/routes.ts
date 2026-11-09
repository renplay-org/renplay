import { join } from 'node:path'
import { Router } from 'express'
import YAML from 'yaml'
import { viewer } from '../accounts/context.js'
import { parseJson, type GameSource } from '../db.js'
import { installedRelease } from '../shared/recipe.js'
import type { Services } from '../services.js'
import { exists } from '../util/fsx.js'
import type { CatalogGame, CatalogResponse, DraftRecipe } from '../shared/api.js'

/** The catalog's recipe schema, for editors that validate YAML (yaml-language-server). */
const RECIPE_SCHEMA_URL = 'https://catalog.renplay.org/recipe.schema.json'

/** The catalog as this person may see it, its refresh, and a draft recipe for a library game. */
export function createCatalogRouter(s: Services): Router {
  const { cfg, db, jobs, catalog, content, version } = s
  const router = Router({ caseSensitive: true, strict: true })

  router.get('/catalog', async (_req, res) => {
    const games = db.allGames().filter((g) => !content.hides(g))
    res.json({
      // Where Your recipes live on the server is for admins.
      status: { ...catalog.status(), count: catalog.list().length, sources: catalog.sources().map((s) => (s.kind === 'folder' && viewer()?.user.role !== 'admin' ? { ...s, location: '' } : s)) },
      vocabulary: content.hidesRecipe(true) ? Object.fromEntries(Object.entries(catalog.vocabulary).filter(([, v]) => v.group !== 'content')) : catalog.vocabulary,
      games: catalog.list().map((r): CatalogGame => {
        const local = games.find((g) => g.recipe_id === r.id) ?? (r.saveDir ? games.find((g) => g.save_dir === r.saveDir) : undefined)
        // The source as the interface says it: Your recipes, or the catalog (its address stays here).
        const { _base, _origin, ...recipe } = r
        return { ...recipe, fromYourRecipes: _origin === 'local' || undefined, art: catalog.recipeArt(r), local: local ? { id: local.id, status: local.status, version: installedRelease(r, local.version, parseJson<GameSource>(local.source, {}).archive)?.version ?? local.version, detectedVersion: local.version } : null }
      }),
    } satisfies CatalogResponse)
  })

  router.post('/catalog/refresh', async (_req, res) => {
    res.json(await catalog.refresh())
  })


  // A draft recipe for a library game, to start one for the catalog or Your recipes.
  router.get('/games/:id/recipe', async (req, res) => {
    const g = content.game(req.params.id)
    const src = parseJson<GameSource>(g.source, {})
    let sha256 = src.sha256 ?? ''
    if (!sha256 && src.archive) sha256 = db.getArchive(src.archive)?.sha256 ?? ''
    let hashJob: string | null = null
    if (!sha256 && src.archive && (await exists(join(cfg.archivesDir, src.archive)))) {
      const running = db.listJobs(100).find((j) => j.type === 'hash-archive' && (j.status === 'queued' || j.status === 'running') && parseJson<{ path?: string }>(j.params, {}).path === src.archive)
      hashJob = running?.id ?? jobs.enqueue('hash-archive', '', { path: src.archive })
    }
    const existing = g.recipe_id ? catalog.recipe(g.recipe_id) : null
    const recipe = {
      id: g.recipe_id || g.id,
      title: existing?.title ?? g.title,
      developer: existing?.developer ?? '',
      tags: existing?.tags ?? [],
      nsfw: existing?.nsfw ?? false,
      links: existing?.links ?? { website: '' },
      saveDir: g.save_dir || undefined,
      continuesFrom: existing?.continuesFrom,
      match: existing?.match,
      engine: existing?.engine ?? ((g.family || 'renpy') as 'renpy'),
      runtime: existing?.runtime,
      build: existing?.build,
      releases: [
        {
          version: g.version || 'unknown',
          madeWith: g.renpy_version || undefined,
          runtime: g.engine || undefined,
          status: 'untested',
          archives: src.archive ? [{ name: src.archive.split('/').pop(), size: src.size, sha256: sha256 || 'pending' }] : [],
          verified: { date: new Date().toISOString().slice(0, 10), renplay: version, browsers: [], notes: '' },
        },
        ...(existing?.releases.filter((r) => r.version !== g.version) ?? []),
      ],
    }
    const yaml = `# yaml-language-server: $schema=${RECIPE_SCHEMA_URL}\n${YAML.stringify(JSON.parse(JSON.stringify(recipe)), { lineWidth: 0 })}`
    res.json({ yaml, sha256Pending: !sha256, hashJob } satisfies DraftRecipe)
  })

  return router
}
