import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { gzipSync } from 'node:zlib'

const repo = new URL('../../../', import.meta.url).pathname

/** A small catalog, made up: the safe-for-work index's shape with a dozen games, whose covers are at an address nothing answers (the build then makes each card without one). */
export function catalog({ adult = 0 } = {}) {
  const tints = ['#586dda', '#d6798f', '#a72296', '#c79785', '#c4a77a', '#653973', '#3c4b73', '#a98762', '#afbfe5', '#657d5b', '#6181d3', '#94674e', '#7a5c3c', '#4f7a7a']
  const games = tints.map((tint, i) => ({
    id: `game-${i + 1}`,
    title: `Game ${i + 1}`,
    developer: `Developer ${i % 3}`,
    tags: [],
    tagIds: i % 2 ? ['romance', 'comedy'] : ['romance', 'horror'],
    state: ['ongoing', 'completed', 'on-hold'][i % 3],
    summary: `A made-up visual novel, number ${i + 1}.`,
    nsfw: i < adult,
    free: true,
    engine: 'renpy',
    links: { itch: `https://developer.itch.io/game-${i + 1}` },
    art: [{ kind: 'grid', url: `http://127.0.0.1:59999/covers/game-${i + 1}.jpg`, width: 600, height: 900, tint, avg: tint, default: true, thumbhash: 'YQYKTQatZ06DSJiIt3CFiIeAiAam' }],
    releases: [{ version: '1.0', date: '2026-10-01', status: 'playable', archives: [{ name: `game-${i + 1}-pc.zip`, size: 200e6, platform: 'pc' }], verified: { date: '2026-11-01', renplay: '4.13.0', notes: 'Played from its main menu to a save that loads again.' } }],
  }))
  return {
    schema: 4,
    generated: '2026-11-11T07:00:00.000Z',
    vocabulary: { romance: { label: 'Romance', group: 'story' }, comedy: { label: 'Comedy', group: 'story' }, horror: { label: 'Horror', group: 'story' } },
    games,
  }
}

/** A cover: a flat picture of the game's colour, so the page has something to draw where the catalog's host would answer. */
export const cover = (tint) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="${tint}"/></svg>`

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

/** A built site served as Cloudflare serves it: a folder answers with its index.html (a slash added), a missing path with 404.html and status 404. */
async function serveSite(dir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let file = normalize(join(dir, decodeURIComponent(url.pathname)))
    if (!file.startsWith(dir)) return void res.writeHead(403).end()
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!url.pathname.endsWith('/')) return void res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end()
      file = join(file, 'index.html')
    }
    const missing = !existsSync(file)
    if (missing) file = join(dir, '404.html')
    // Text is compressed on the way, as the host does it, so the weight a test reads is what a phone would download.
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    let body = readFileSync(file)
    const headers = { 'content-type': type }
    if (/^(text\/|application\/(json|xml)|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) { body = gzipSync(body); headers['content-encoding'] = 'gzip' }
    res.writeHead(missing ? 404 : 200, { ...headers, 'content-length': body.length }).end(body)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { port: server.address().port, close: () => new Promise((done) => server.close(done)) }
}

/** Builds the website (renplay.org and adult.renplay.org) from the made-up catalog into a folder of its own, and serves both. */
export async function website({ adult = 4 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'renplay-website-'))
  const file = join(dir, 'catalog.json')
  writeFileSync(file, JSON.stringify(catalog()))
  const out = join(dir, 'dist'), outAdult = join(dir, 'dist-adult')
  execFileSync(process.execPath, [join(repo, 'website/build.mjs')], { env: { ...process.env, CATALOG_INDEX_FILE: file, WEBSITE_OUT: out, WEBSITE_OUT_ADULT: outAdult }, stdio: 'pipe', maxBuffer: 1 << 24 })
  const main = await serveSite(out)
  const gate = await serveSite(outAdult)
  return {
    origin: `http://127.0.0.1:${main.port}`,
    adultOrigin: `http://127.0.0.1:${gate.port}`,
    full: catalog({ adult }),
    sfw: catalog(),
    close: async () => { await main.close(); await gate.close() },
  }
}

/**
 * The demo as the website's frames see it: a page that says `ready` once it has loaded, `engaged` at the first touch, and
 * `saved` when its Save button is pressed, and keeps what the website sends it (`nudge`, `refresh`) in window.received.
 */
export const demoPage = `<!doctype html><html><head><title>Renplay demo</title></head><body style="margin:0;background:#12121a;color:#fff;font:16px sans-serif">
<p id="what">The demo, as a test makes it</p>
<button id="save" type="button" style="font-size:24px;padding:16px">Save</button>
<script>
  window.received = []
  addEventListener('message', (e) => { window.received.push(e.data.type) })
  const tell = (m) => parent.postMessage(m, '*')
  tell({ type: 'renplay-embed:ready' })
  addEventListener('pointerdown', () => { if (!window.engaged) { window.engaged = true; tell({ type: 'renplay-embed:engaged' }) } })
  document.getElementById('save').addEventListener('click', () => tell({ type: 'renplay-embed:saved', gameId: 'the-question', label: 'Chapter 1', time: Date.now() }))
</script></body></html>`
