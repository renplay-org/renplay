import { readdir } from 'node:fs/promises'
import { Router } from 'express'
import { BUILD_RE, baseOf, type Builds } from '../builds.js'
import type { Db } from '../db.js'
import type { EngineStore } from '../engines.js'
import { HttpError, assertSlug } from '../util/paths.js'

/**
 * Serves a game page: the engine's page template with renplay's runtime wired
 * in. Everything else under /g/ is static and served by nginx.
 */
export function createPlayRouter(db: Db, builds: Builds, engines: EngineStore, runtimeVersion: string): Router {
  const router = Router()

  router.get(['/g/:id/:build/', '/g/:id/:build/index.html'], async (req, res) => {
    const id = assertSlug(req.params.id)
    const game = db.getGame(id)
    if (!game || game.status !== 'installed' || !game.build) throw new HttpError(404, 'Game not installed')
    if (req.params.build !== game.build || !BUILD_RE.test(req.params.build)) {
      // Old build ids redirect to the current one, so bookmarks keep working.
      res.redirect(302, `/g/${id}/${game.build}/`)
      return
    }
    const template = await engines.template(game.engine)
    const presplash = await findPresplash(builds.dir(id, baseOf(game.build)))
    const html = renderPage(template, {
      id,
      build: game.build,
      title: game.title,
      engine: game.engine,
      saveDir: game.save_dir || null,
      screen: game.screen_w ? [game.screen_w, game.screen_h] : null,
      caches: await builds.caches(id, game.build),
      presplash: presplash ?? `/engine/${game.engine}/web-presplash.jpg`,
      runtimeVersion,
    })
    res.setHeader('Cache-Control', 'no-cache')
    res.type('html').send(html)
  })

  return router
}

async function findPresplash(dir: string): Promise<string | null> {
  try {
    return (await readdir(dir)).find((n) => /^web-presplash\.(png|jpe?g|webp)$/i.test(n)) ?? null
  } catch {
    return null
  }
}

export interface PageOptions {
  id: string
  build: string
  title: string
  engine: string
  saveDir: string | null
  screen: [number, number] | null
  caches: Array<{ name: string; v: string }>
  presplash: string
  runtimeVersion: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderPage(template: string, o: PageOptions): string {
  const config = {
    id: o.id,
    build: o.build,
    saveDir: o.saveDir,
    screen: o.screen,
    title: o.title,
    engineBase: `/engine/${o.engine}/`,
    caches: o.caches,
  }
  const boot =
    `<script>window.__renplay=${JSON.stringify(config).replace(/</g, '\\u003c')};</script>` +
    `<script src="/renplay/runtime.js?v=${o.runtimeVersion}"></script>` +
    `<script src="/engine/${o.engine}/renpy-pre.js"></script>` +
    `<script>window.__renplayLate && window.__renplayLate()</script>`

  let out = template
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${esc(o.title)}</title>`)
  // renplay is the app; the per-game PWA bits of Ren'Py's template do not apply.
  out = out.replace(/<link[^>]+rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*/gi, '')
  out = out.replace(/navigator\.serviceWorker\.register\(/g, '(function () { return Promise.resolve() })(')
  out = out.replace(/(<img[^>]*id="presplash"[^>]*src=)"[^"]*"/i, `$1"${esc(o.presplash)}"`)
  out = out.replace(/<script[^>]*\ssrc=["']renpy-pre\.js["'][^>]*><\/script>/, boot)
  // renpy.js is started by the runtime once the engine is downloaded.
  out = out.replace(/<script[^>]*\ssrc=["']renpy\.js["'][^>]*><\/script>/, '')
  out = out.replace(/<meta name="viewport"[^>]*>/i, '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">')
  return out
}
