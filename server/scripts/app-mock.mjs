// A made-up API for the app's browser checks: 130 games and 120 catalog recipes with pictures drawn on
// the fly, and every other answer the library asks for. Every request that would change something is
// answered with ok, so a check can click anything.
// ---- the made-up API ----------------------------------------------------------------------------

export const GAMES = 130
export const RECIPES = 120
const id = (prefix, n) => `${prefix}-${String(n).padStart(3, '0')}`
const art = (slug) => ({
  grid: { url1x: `/api/art/${slug}-grid.svg`, url2x: null, width: 600, height: 900, thumbhash: null, tint: '#6a7ad0', made: null },
  wide: { url1x: `/api/art/${slug}-wide.svg`, url2x: null, width: 920, height: 430, thumbhash: null, tint: '#6a7ad0', made: null },
  hero: { url1x: `/api/art/${slug}-hero.svg`, url2x: null, width: 1920, height: 620, thumbhash: null, tint: '#6a7ad0', made: null },
  icon: { url1x: `/api/art/${slug}-icon.svg`, url2x: null, width: 512, height: 512, thumbhash: null, tint: '#6a7ad0', made: 'crop' },
})
const games = Array.from({ length: GAMES }, (_, i) => ({
  id: id('game', i), title: `Game ${i}`, developer: 'Studio', tags: ['romance'], tagIds: ['romance'], content: [], state: 'completed', summary: 'A short story.',
  art: art(id('game', i)), nsfw: false, walkthroughs: [], status: 'installed', build: 'b1', playUrl: `/g/${id('game', i)}/b1/`, family: 'renpy', engineLabel: null,
  version: '1.0', detectedVersion: '1.0', favoriteAt: null, finishedAt: null, playTime: 0, playStatus: null, rating: null, notNowAt: null, phone: null, latestSave: null,
  free: true, renpyVersion: '8.3.7', engine: '8.5.3', sizeBytes: 1e8, fileCount: 4, screen: [1280, 720], saveDir: `save-${i}`, source: { archive: null, size: null },
  canReinstall: false, recipe: null, update: null, createdAt: '2026-01-01T00:00:00.000Z', installedAt: '2026-01-01T00:00:00.000Z',
  lastPlayedAt: i < 4 ? `2026-11-0${9 - i}T10:00:00.000Z` : null, saves: { count: 0, latest: 0 }, mods: { files: 0, hash: '', applied: false }, job: null,
}))
const recipes = Array.from({ length: RECIPES }, (_, i) => ({
  id: id('game', i), title: `Recipe ${i}`, developer: 'Studio', tags: ['romance', i % 2 ? 'fantasy' : 'drama'], tagIds: ['romance', i % 2 ? 'fantasy' : 'drama'], content: [], state: 'completed', summary: 'A short story.',
  nsfw: false, free: true, art: art(id('recipe', i)), links: {}, saveDir: `r${i}`, match: [], runtime: '8.5.3', releases: [], engine: 'renpy',
  local: i < 4 ? { id: id('game', i), status: 'installed', version: '1.0', detectedVersion: '1.0' } : null,
}))
const vocabulary = { romance: { label: 'Romance', group: 'story' }, fantasy: { label: 'Fantasy', group: 'story' }, drama: { label: 'Drama', group: 'story' } }
const catalog = { status: { fetchedAt: Date.now(), urls: [], errors: [], count: RECIPES, sources: [] }, vocabulary, games: recipes }
const me = { user: { id: 1, username: 'owner', name: 'Owner', role: 'admin', disabled: 0, created_at: '2026-01-01T00:00:00.000Z', prefs: '{}', avatar: '', avatar_uploaded: 0, admin_source: 'manual', admin_provider: '', admin_subject: '', adult_ceiling: 'off', adult_choice: 'off', adult_access: 0, hasPin: false }, auth: false, demo: false, unclaimed: false, hasPassword: false }

const answers = (url) => {
  const path = url.pathname
  if (path === '/api/games') return { games }
  const one = path.match(/^\/api\/games\/([^/]+)$/)
  if (one) return { game: games.find((g) => g.id === one[1]) }
  if (path === '/api/catalog') return catalog
  if (path === '/api/me') return me
  if (path === '/api/me/tags') return { include: [], exclude: [], source: 'default' }
  if (path === '/api/me/adult') return { installation: { level: 'off', fixed: true, chosen: true }, ceiling: { level: 'off', managed: null }, choice: 'off', effective: 'off' }
  if (path === '/api/content') return { installation: { level: 'off', fixed: true, chosen: true, variable: 'RENPLAY_ADULT_GAMES' }, starting: { level: 'off', variable: 'RENPLAY_ADULT_DEFAULT' }, groups: { oidc: null, ldap: null } }
  if (path === '/api/auth/providers') return { enabled: false, setup: false, local: true, oidc: null, ldap: false, demo: false }
  if (path === '/api/jobs') return { jobs: [], busy: false, total: 0 }
  if (path === '/api/health') return { ok: true, uptime: 1, version: '0.0.0' }
  if (path === '/api/defaults') return { tagsExclude: [], lighterBackground: null, textSize: null, rollback: null, skip: null }
  if (path.startsWith('/api/saves/')) return { saveDir: 'x', slots: [], other: [], conflicts: [], sync: false }
  if (path === '/api/history') return { totals: { seconds: 0, sessions: 0, games: 0, since: null }, days: [], games: [], next: null }
  return {}
}

/** A picture in the shape its name says, in a colour from the game's name. */
function picture(url) {
  const [, name, kind] = url.pathname.match(/\/api\/art\/(.+)-(grid|wide|hero|icon)\.svg$/) ?? []
  const [w, h] = { grid: [600, 900], wide: [920, 430], hero: [1920, 620], icon: [512, 512] }[kind ?? 'grid']
  const hue = [...(name ?? '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="hsl(${hue} 55% 45%)"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 3}" fill="hsl(${hue} 60% 70%)"/></svg>`
}

export async function mock(page, errors, label) {
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
  await page.route('**/api/**', (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/art/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: picture(url) })
    if (request.method() !== 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answers(url)) })
  })
}

