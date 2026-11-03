import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Router } from 'express'
import { BUILD_RE, baseOf, type Builds } from '../builds.js'
import type { Db } from '../db.js'
import type { EngineStore } from '../engines.js'
import { PackReader } from '../pipeline/pack.js'
import { HttpError, assertSlug, cleanRelPath, isSlug } from '../util/paths.js'

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

  /**
   * Streamed assets of a build, from its pack (mod builds use their base's).
   * Supports byte ranges: browsers seek in videos with them.
   */
  router.get(/^\/g\/([a-z0-9][a-z0-9._-]*)\/([a-z0-9]+)(?:\.m[a-z0-9]+)?\/game\/(.+)$/, async (req, res) => {
    const [id, base, raw] = [req.params[0], req.params[1], req.params[2]] as string[]
    const name = safeName(raw)
    if (!name || !isSlug(id)) throw new HttpError(404, 'Not found')
    const reader = new PackReader(join(builds.dir(id, base), 'assets.pack'), join(builds.dir(id, base), 'assets.json'))
    let entry: [number, number] | null
    try {
      entry = await reader.entry(name)
    } catch {
      entry = null
    }
    if (!entry) throw new HttpError(404, 'Not found')
    const size = entry[1]
    res.setHeader('Content-Type', mimeOf(name))
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('ETag', `"${base}-${entry[0].toString(36)}"`)
    let from = 0
    let to = size - 1
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
    if (range && size > 0) {
      if (range[1]) {
        from = Number(range[1])
        if (range[2]) to = Math.min(size - 1, Number(range[2]))
      } else if (range[2]) from = Math.max(0, size - Number(range[2]))
      if (from > to || from >= size) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end()
        return
      }
      res.status(206).setHeader('Content-Range', `bytes ${from}-${to}/${size}`)
    }
    res.setHeader('Content-Length', String(size ? to - from + 1 : 0))
    if (req.method === 'HEAD' || !size) {
      res.end()
      return
    }
    const s = reader.stream(entry, from, to)
    s.on('error', () => res.destroy())
    req.on('close', () => s.destroy())
    s.pipe(res)
  })

  return router
}

/** Decodes and validates an asset path from a URL. */
function safeName(raw: string): string | null {
  let name = raw
  try {
    if (/%[0-9a-f]{2}/i.test(raw)) name = decodeURIComponent(raw)
  } catch {
    return null
  }
  try {
    return cleanRelPath(name)
  } catch {
    return null
  }
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'video/webm',
  mp4: 'video/mp4',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
}

function mimeOf(name: string): string {
  return MIME[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
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
  // Ren'Py's own menu imports and exports browser-local saves, which renplay
  // replaces with saves on the server; the player has its own controls. The
  // canvas takes keyboard focus on every click and key, and browsers would
  // outline the whole game for it.
  out = out.replace(/<\/head>/i, '<style>#ContextContainer{display:none!important}#canvas,#canvas:focus,#canvas:focus-visible{outline:none!important}</style></head>')
  return out
}
