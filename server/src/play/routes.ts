import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import express, { Router, type NextFunction, type Request, type Response } from 'express'
import { viewer } from '../accounts/context.js'
import { BUILD_RE, baseOf, modBuild } from '../games/builds.js'
import { isWebGame, type GameRow } from '../db.js'
import { ENGINE_FILES } from '../engines.js'
import { PackReader } from '../pipeline/pack.js'
import { isPresplash } from '../pipeline/project.js'
import { HttpError, assertSlug, cleanRelPath, isSlug } from '../util/paths.js'
import { HTML_STORAGE_FILES } from '../shared/html.js'
import type { Services } from '../services.js'
import type { OfflineManifest } from '../shared/api.js'
import { parseGamePath, type GamePath } from './path.js'
import { readRuntimes } from './runtime.js'

// Game pages play only inside Renplay's own player: another site cannot frame them to trick people
// into clicks. Checked in Chromium and WebKit, sandboxed pages too. The library stays embeddable
// (dashboards frame it).
const FRAME_ANCESTORS = "frame-ancestors 'self'"

/** The URL an installed game plays at. HTML games start at their own page. */
export function playPath(g: GameRow): string {
  if (isWebGame(g)) return `/g/${g.id}/${g.build}/game/${g.entry.split('/').map(encodeURIComponent).join('/')}`
  return `/g/${g.id}/${g.build}/`
}

/**
 * Game pages: the engine's page template with Renplay's runtime wired in, the runtimes themselves,
 * and the files of a build and the engines. nginx serves the static files in production.
 */
export function createPlayRouter(s: Services): Router {
  const { cfg, db, builds, engines, content, accounts, telemetry } = s
  const runtimes = readRuntimes()
  const runtimeVersion = runtimes.version
  const router = Router({ caseSensitive: true, strict: true })

  router.get(['/g/:id/:build/', '/g/:id/:build/index.html'], async (req, res) => {
    const id = assertSlug(req.params.id)
    const game = db.getGame(id)
    if (!game || game.status !== 'installed' || !game.build || content.hides(game)) throw new HttpError(404, 'Game not installed')
    if (req.params.build !== game.build || !BUILD_RE.test(req.params.build) || isWebGame(game)) {
      // Old build ids redirect to the current one, so bookmarks keep working.
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
      res.redirect(302, playPath(game) + query)
      return
    }
    const template = await engines.template(game.engine)
    // Blurred: no byte of the game's art leaves the server, so the build's presplash stays out.
    const presplash = content.blurs(game) ? null : await findPresplash(builds.dir(id, baseOf(game.build)))
    const html = renderPage(template, {
      id,
      build: game.build,
      title: game.title,
      engine: game.engine,
      saveDir: game.save_dir || null,
      screen: game.screen_w ? [game.screen_w, game.screen_h] : null,
      caches: await builds.caches(id, game.build),
      presplash: presplash ?? `/engine/${game.engine}/${ENGINE_FILES.presplash}`,
      runtimeVersion,
      userId: accounts.current().id,
    })
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Security-Policy', FRAME_ANCESTORS)
    res.type('html').send(html)
  })

  /**
   * What a browser keeps to play a Ren'Py game offline: the page, the runtime, the engine, the build's
   * files and every streamed file, with their sizes. Pictures of the game are not in it: the browser
   * keeps the ones it was sent, so Blurred keeps none. The presplash follows the page's rule.
   */
  router.get('/api/games/:id/offline', async (req, res) => {
    const id = assertSlug(req.params.id)
    const game = db.getGame(id)
    if (!game || game.status !== 'installed' || !game.build || content.hides(game)) throw new HttpError(404, 'Game not installed')
    if (isWebGame(game) || !game.engine) throw new HttpError(409, 'Only Ren’Py games can be kept offline for now')
    const base = baseOf(game.build), page = playPath(game)
    const size = async (...paths: string[]) => {
      for (const p of paths) {
        const st = await stat(p).catch(() => null)
        if (st?.isFile()) return st.size
      }
      return 0
    }
    const at = (b: string, name: string) => join(builds.dir(id, b), name)
    const engine = engines.dir(game.engine)
    const files: Array<{ url: string; bytes: number }> = [
      { url: page, bytes: 0 },
      { url: `/renplay/runtime.js?v=${runtimeVersion}`, bytes: 0 },
      ...(await Promise.all([ENGINE_FILES.pre, ENGINE_FILES.main, ENGINE_FILES.wasm, ENGINE_FILES.data].map(async (n) => ({ url: `/engine/${game.engine}/${n}`, bytes: await size(join(engine, n)) })))),
    ]
    const presplash = content.blurs(game) ? null : await findPresplash(builds.dir(id, base))
    files.push(presplash ? { url: `${page}${presplash}`, bytes: await size(at(base, presplash)) } : { url: `/engine/${game.engine}/${ENGINE_FILES.presplash}`, bytes: await size(join(engine, ENGINE_FILES.presplash)) })
    files.push({ url: `${page}game.zip`, bytes: await size(at(game.build, 'game.zip'), at(base, 'game.zip')) })
    for (const c of await builds.caches(id, game.build)) {
      files.push({ url: `${page}cache/${c.name.split('/').map(encodeURIComponent).join('/')}?v=${encodeURIComponent(c.v)}`, bytes: await size(at(game.build, `cache/${c.name}`), at(base, `cache/${c.name}`)) })
    }
    const streamed = JSON.parse(await readFile(at(base, 'assets.json'), 'utf-8').catch(() => '{}')) as Record<string, [number, number]>
    for (const [name, [, bytes]] of Object.entries(streamed)) files.push({ url: `${page}game/${name.split('/').map(encodeURIComponent).join('/')}`, bytes })
    res.setHeader('Cache-Control', 'private, no-store')
    telemetry.feature('keptOffline')
    res.json({ id, build: game.build, page, bytes: files.reduce((n, f) => n + f.bytes, 0), files } satisfies OfflineManifest)
  })

  /**
   * Streamed assets of a build, from its pack (mod builds use their base's).
   * Supports byte ranges: browsers seek in videos with them.
   */
  const sendPackFile = async (where: GamePath, req: Request, res: Response): Promise<void> => {
    const { game: id, base } = where
    const name = safeName(decodePart(where.rest.slice(5)))
    const installed = db.getGame(id)
    if (accounts.enabled && installed && isWebGame(installed) && !res.locals.verifiedAsset) throw new HttpError(403, 'Open this game from the library')
    if (!name || !isSlug(id) || content.hides(db.getGame(id))) throw new HttpError(404, 'Not found')
    const reader = new PackReader(join(builds.dir(id, base), 'assets.pack'), join(builds.dir(id, base), 'assets.json'))
    let entry: [number, number] | null
    try {
      entry = await reader.entry(name)
    } catch {
      entry = null
    }
    if (!entry) throw new HttpError(404, 'Not found')
    // Other engines' games run in sandboxed frames, whose requests come from an opaque origin.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (installed && isWebGame(installed)) {
      // Sandbox every pack response, independent of MIME, suffixes or browser sniffing.
      // This follows direct navigations, secondary pages and popups too.
      // Never allow-same-origin or popup escape: game scripts must not gain account cookies.
      res.setHeader('Content-Security-Policy', `sandbox allow-scripts allow-modals allow-pointer-lock allow-popups allow-downloads allow-forms; ${FRAME_ANCESTORS}`)
    }
    if (/\.html?$/i.test(name)) {
      const game = db.getGame(id)
      // The pack finds a page asked for in another case: it still gets the runtime.
      if (game && isWebGame(game) && game.entry.toLowerCase() === name.toLowerCase() && game.build && baseOf(game.build) === base) {
        const page = (await reader.read(name)) ?? Buffer.alloc(0)
        res.setHeader('Cache-Control', 'no-store')
        res.type('html').send(await htmlPage(page.toString('utf-8'), game))
        return
      }
    }
    const size = entry[1]
    res.setHeader('Content-Type', mimeOf(name))
    res.setHeader('Cache-Control', 'private, no-store')
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
  }

  /**
   * An HTML game's page with Renplay's runtime and the game's stored
   * localStorage put first in <head>, before any of the game's scripts.
   */
  async function htmlPage(page: string, game: GameRow): Promise<string> {
    const stored = async (name: string): Promise<Record<string, unknown> | null> => {
      if (!game.save_dir) return null
      try {
        const parsed = JSON.parse((await s.saves.read(game.save_dir, name)).toString('utf-8'))
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch {
        return null
      }
    }
    const storage = (await stored(HTML_STORAGE_FILES.local)) ?? {}
    const idb = await stored(HTML_STORAGE_FILES.idb)
    const cfg = JSON.stringify({ id: game.id, build: game.build, userId: viewer()?.user.id ?? 1, storage, idb }).replace(/</g, '\\u003c')
    const inject = `<script>window.__renplay=${cfg};</script><script>${runtimes.html}</script>`
    const head = page.match(/<head\b[^>]*>/i)
    if (head) return page.slice(0, head.index! + head[0].length) + inject + page.slice(head.index! + head[0].length)
    const doctype = page.match(/^\s*<!doctype[^>]*>/i)
    return doctype ? doctype[0] + inject + page.slice(doctype[0].length) : inject + page
  }

  // Ren'Py's runtime, built at start. Its address carries its version, so browsers keep it.
  router.get('/renplay/runtime.js', (_req, res) => {
    res.type('text/javascript').setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(runtimes.renpy)
  })
  // A static fallback for development: nginx serves the engines in production.
  router.use('/engine', express.static(cfg.enginesDir, { immutable: true, maxAge: '365d', setHeaders: gzipHeaders }))
  // game.zip, caches and presplash of a build (mod builds fall back to their base).
  const sendBuildFile = (where: GamePath, res: Response, next: NextFunction): void => {
    const { game, base, mod } = where
    const asset = decodePart(where.rest)
    if (asset.includes('..')) return next()
    if (content.hides(db.getGame(game))) return next(new HttpError(404, 'Game not found'))
    if (isPresplash(asset) && content.blurs(db.getGame(game))) return next(new HttpError(404, 'Not found'))
    const candidates = mod ? [join(cfg.gamesDir, game, modBuild(base, mod), asset), join(cfg.gamesDir, game, base, asset)] : [join(cfg.gamesDir, game, base, asset)]
    const tryNext = (i: number): void => {
      if (i >= candidates.length) return next()
      res.sendFile(candidates[i]!, { cacheControl: false }, (err) => (err ? tryNext(i + 1) : undefined))
    }
    tryNext(0)
  }
  router.get(/^\/g\//, async (req, res, next) => {
    const where = parseGamePath(req.path)
    if (!where?.rest) return next()
    if (where.rest.startsWith('game/') && where.rest.length > 5) return sendPackFile(where, req, res)
    sendBuildFile(where, res, next)
  })
  return router
}

/** The part of an address after the build, decoded the way Express decodes a route parameter. */
function decodePart(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    throw new HttpError(400, 'Failed to decode param')
  }
}

/** Express has already decoded the route parameter. Validate without decoding or normalizing it again. */
function safeName(raw: string): string | null {
  if (/[\\\x00-\x1f\x7f]/.test(raw) || raw.split('/').some((part) => !part || part === '.' || part === '..')) return null
  try {
    return cleanRelPath(raw)
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
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ico: 'image/x-icon',
  // HTML games load their own pages, scripts and styles; nginx sends nosniff, so these must be right.
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

function mimeOf(name: string): string {
  // Unity WebGL builds name files game.wasm.br or .gz; served as they are (itch.io, for one, keeps
  // them uncompressed), they need the type of the name underneath, or wasm compiles slowly.
  const bare = name.replace(/\.(br|gz)$/i, '')
  return MIME[bare.slice(bare.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
}

async function findPresplash(dir: string): Promise<string | null> {
  try {
    return (await readdir(dir)).find(isPresplash) ?? null
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
  userId?: number
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The script tag of Ren'Py's page template that loads one of the engine's files. */
const scriptTag = (file: string) => new RegExp(`<script[^>]*\\ssrc=["']${file.replaceAll('.', '\\.')}["'][^>]*></script>`)

export function renderPage(template: string, o: PageOptions): string {
  const config = {
    id: o.id,
    userId: o.userId ?? 1,
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
    `<script src="/engine/${o.engine}/${ENGINE_FILES.pre}"></script>` +
    `<script>window.__renplayLate && window.__renplayLate()</script>`

  let out = template
  out = out.replace(/<title>[^<]*<\/title>/i, `<title>${esc(o.title)}</title>`)
  // renplay is the app; the per-game PWA bits of Ren'Py's template do not apply.
  out = out.replace(/<link[^>]+rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*/gi, '')
  out = out.replace(/navigator\.serviceWorker\.register\(/g, '(function () { return Promise.resolve() })(')
  out = out.replace(/(<img[^>]*id="presplash"[^>]*src=)"[^"]*"/i, `$1"${esc(o.presplash)}"`)
  out = out.replace(scriptTag(ENGINE_FILES.pre), boot)
  // renpy.js is started by the runtime once the engine is downloaded.
  out = out.replace(scriptTag(ENGINE_FILES.main), '')
  out = out.replace(/<meta name="viewport"[^>]*>/i, '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">')
  // Ren'Py's own menu imports and exports browser-local saves, which renplay
  // replaces with saves on the server; the player has its own controls. The
  // canvas takes keyboard focus on every click and key, and browsers would
  // outline the whole game for it.
  out = out.replace(/<\/head>/i, '<style>#ContextContainer{display:none!important}#canvas,#canvas:focus,#canvas:focus-visible{outline:none!important}</style></head>')
  return out
}


/** Development server: serve *.gz engine files with their encoding, like nginx does. */
function gzipHeaders(res: express.Response, path: string) {
  if (path.endsWith('.wasm.gz')) res.setHeader('Content-Type', 'application/gzip')
}
