import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Router } from 'express'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import { readMarker } from '../library.js'
import { engineReady } from '../pipeline/engine.js'
import { HttpError, assertSlug } from '../util/paths.js'

interface Cached {
  key: string
  html: string
}

/**
 * Serves a game's index.html with renplay's runtime wired in. Everything else
 * under /g/ is static and served by nginx straight from the games volume.
 */
export function createPlayRouter(cfg: Config, db: Db, runtimeVersion: string): Router {
  const router = Router()
  const cache = new Map<string, Cached>()

  router.get(['/g/:slug/:build/', '/g/:slug/:build/index.html'], async (req, res) => {
    const slug = assertSlug(req.params.slug)
    const game = db.getGame(slug)
    if (!game || game.status !== 'installed') throw new HttpError(404, 'Game not installed')
    const dir = join(cfg.gamesDir, slug)
    const indexPath = join(dir, 'index.html')
    let st
    try {
      st = await stat(indexPath)
    } catch {
      throw new HttpError(404, 'Game files missing')
    }
    // Old build ids redirect to the current one, so bookmarks keep working.
    if (req.params.build !== game.build_id) {
      res.redirect(302, `/g/${slug}/${game.build_id}/`)
      return
    }
    const marker = await readMarker(dir)
    const engine = game.engine && (await engineReady(cfg.enginesDir, game.engine)) ? game.engine : null
    const key = [st.mtimeMs, game.build_id, marker?.zipRev ?? 0, engine, game.save_dir, game.screen_w, runtimeVersion].join('|')
    let entry = cache.get(slug)
    if (!entry || entry.key !== key) {
      const html = await readFile(indexPath, 'utf-8')
      entry = {
        key,
        html: renderIndex(html, {
          slug,
          build: game.build_id,
          zipRev: marker?.zipRev ?? 0,
          engine,
          saveDir: game.save_dir || null,
          screen: game.screen_w ? [game.screen_w, game.screen_h] : null,
          title: game.title,
          runtimeVersion,
        }),
      }
      cache.set(slug, entry)
    }
    res.setHeader('Cache-Control', 'no-cache')
    res.type('html').send(entry.html)
  })

  return router
}

export interface RenderOptions {
  slug: string
  build: string
  zipRev: number
  engine: string | null
  saveDir: string | null
  screen: [number, number] | null
  title: string
  runtimeVersion: string
}

export function renderIndex(html: string, o: RenderOptions): string {
  const config = {
    slug: o.slug,
    build: o.build,
    saveDir: o.saveDir,
    screen: o.screen,
    title: o.title,
    engineBase: o.engine ? `/engine/${o.engine}/` : null,
  }
  const boot =
    `<script>window.__renplay=${JSON.stringify(config).replace(/</g, '\\u003c')};</script>` +
    `<script src="/renplay/runtime.js?v=${o.runtimeVersion}"></script>`

  let out = html
  // Ren'Py's service worker caches by URL and fights versioned builds; renplay handles caching.
  out = out.replace(/navigator\.serviceWorker\.register\(/g, '(function () { return Promise.resolve() })(')
  out = out.replace(/window\.gameZipURL\s*=\s*(['"])([^'"]+)\1/, (_m, q: string, url: string) => `window.gameZipURL = ${q}${url}?r=${o.zipRev}${q}`)
  const preTag = /<script[^>]*\ssrc=["']renpy-pre\.js["'][^>]*><\/script>/
  const late = '<script>window.__renplayLate && window.__renplayLate()</script>'
  const pre = (o.engine ? `<script src="/engine/${o.engine}/renpy-pre.js"></script>` : '<script src="renpy-pre.js"></script>') + late
  if (preTag.test(out)) out = out.replace(preTag, boot + pre)
  else out = out.replace(/<\/head>/i, boot + '</head>')
  if (o.engine) out = out.replace(/(<script[^>]*\ssrc=)["']renpy\.js["']/, `$1"/engine/${o.engine}/renpy.js"`)
  out = out.replace(/<meta name="viewport"[^>]*>/i, '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">')
  return out
}
