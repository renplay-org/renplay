// Reads what the static demo needs from a running demo server: the API's answers, the game page as the server renders
// it, and the runtime. Reads only: the server is never changed. The files of the games' builds come from the demo
// image's build (snapshot.mjs), and the engine stays on engines.renplay.org.
//
// The guest is signed in the way the demo's own page does it. One stand-in guest is the same on every visit.

import { SNAPSHOT_ROUTES } from './snapshot-routes.mjs'

export const ENGINES = 'https://engines.renplay.org'

/**
 * The art of a catalog entry that the catalog page shows: the grid. A game the library holds keeps all five formats.
 * @param {Record<string, unknown>} entry
 */
function gridOnly(entry) {
  const art = /** @type {Record<string, unknown> | undefined} */ (entry.art)
  return { ...entry, art: art?.grid ? { grid: art.grid } : {} }
}

/** The catalog as the static demo keeps it: every entry's art is its grid. */
export const trimCatalog = (catalog) => ({ ...catalog, games: catalog.games.map(gridOnly) })

/**
 * @param {{ base: string, embedder: string, fetch?: typeof fetch }} options
 *   `embedder` is the one origin the demo's bridge talks to, set at build time.
 */
export async function capture({ base, embedder, fetch: request = fetch }) {
  const signIn = await request(`${base}/api/auth/demo`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: '{}' })
  if (!signIn.ok) throw new Error(`Guest sign-in answered ${signIn.status}`)
  const cookie = signIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const get = async (path) => {
    const res = await request(base + path, { headers: { cookie } })
    if (!res.ok) throw new Error(`${path} answered ${res.status}`)
    return res
  }
  const getJson = async (path) => (await get(path)).json()

  const routes = {}
  for (const path of SNAPSHOT_ROUTES) routes[path] = await getJson(path)
  routes['/api/catalog'] = trimCatalog(routes['/api/catalog'])
  const me = await getJson('/api/me')
  // One stand-in guest, the same on every visit, and the one origin the bridge talks to.
  me.user = { ...me.user, id: 1, username: 'guest', name: 'Guest' }
  me.demoEmbedder = embedder
  me.demoStatic = true
  const { games } = await getJson('/api/games')
  const details = []
  for (const g of games) details.push((await getJson(`/api/games/${g.id}`)).game)
  for (const g of details) {
    const saves = await getJson(`/api/saves/${g.id}`)
    if (saves.slots.length) throw new Error(`${g.id} already has saves: capture from a fresh guest`)
  }

  const art = [...new Set(JSON.stringify([details, routes]).match(/\/api\/art\/[0-9a-f]+\.webp/g) ?? [])]
  const fetchBytes = async (path) => Buffer.from(await (await get(path)).arrayBuffer())

  // The page of each Ren'Py game, as the server renders it. The engine comes from engines.renplay.org, which sends CORS.
  const pages = []
  let runtime = null
  for (const g of details.filter((d) => d.status === 'installed' && d.family === 'renpy')) {
    const page = (await (await get(g.playUrl)).text())
      .replaceAll(`/engine/${g.engine}/`, `${ENGINES}/${g.engine}/`)
      .replace(/"userId":\d+/, '"userId":1')
    const src = page.match(/src="(\/renplay\/runtime\.js)\?v=[^"]*"/)
    if (!src) throw new Error('The page names no runtime')
    runtime ??= await fetchBytes(src[0].match(/src="([^"]+)"/)[1])
    pages.push({ id: g.id, build: g.build, html: page })
  }
  return { snapshot: { routes, me, games: details }, art, fetchArt: fetchBytes, pages, runtime }
}
