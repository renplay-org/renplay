// What the public demo's guest may not do, on top of a player's limits. The server (accounts/access.ts) and the static
// demo's stand-in (demo/static/sw/) both read this list, so the two refuse the same requests.

/** What a refused request is told. */
export const DEMO_REFUSAL = 'The demo cannot do this. Install your own Renplay to try it.'

/** Anything that changes the shared account or adds files to the server. Everything a visitor tries goes at the next restart anyway. */
const REFUSED: Array<[method: string, path: RegExp]> = [
  ['PUT', /^\/api\/me$/],
  ['POST', /^\/api\/me\/(password|avatar|tokens|claim-owner)$/],
  ['PUT', /^\/api\/me\/pin$/],
  ['DELETE', /^\/api\/me\/(tokens|sessions)(\/.*)?$/],
  // The shared account's sessions are other visitors' browsers.
  ['GET', /^\/api\/me\/sessions$/],
  ['*', /^\/api\/me\/identities(\/.*)?$/],
  ['POST', /^\/api\/games\/[^/]+\/art\/upload$/],
  ['DELETE', /^\/api\/games\/[^/]+\/art\/uploads\/.+$/],
  ['POST', /^\/api\/saves-import$/],
  // Choices everyone shares, since everyone is the same guest.
  ['PUT', /^\/api\/me\/(tags|adult)$/],
]

/** The guest's save writes: a game's own saving, a save's name and note, deleting one, restoring one. */
const SAVE_WRITES = /^\/api\/saves\/[^/]+\/(file|meta|slot|history\/restore)$/

/**
 * Whether the demo refuses this request from the guest. Imports, copies, Sync codes and the save folder are
 * refused too: they bring in files or change the game for everyone.
 */
export function demoRefuses(method: string, path: string): boolean {
  if (REFUSED.some(([m, p]) => (m === '*' || m === method) && p.test(path))) return true
  return method !== 'GET' && method !== 'HEAD' && /^\/api\/saves\//.test(path) && !SAVE_WRITES.test(path)
}

/**
 * What the static demo's guest may write: what playing needs, and nothing else. The visitor's browser holds all of it, so
 * it is not the shared guest's account. Every other write is refused, and so is a save's download.
 */
const STATIC_WRITES: Array<[method: string, path: RegExp]> = [
  ['POST', /^\/api\/auth\/demo$/],
  ['POST', /^\/api\/telemetry\/client$/],
  // Resume and the play time.
  ['POST', /^\/api\/games\/[^/]+\/(played|play-time)$/],
  // The game's own saving, as the runtime sends it, and its compiled caches.
  ['PUT', /^\/api\/games\/[^/]+\/cache$/],
  ['PUT', /^\/api\/saves\/[^/]+\/file$/],
  ['DELETE', /^\/api\/saves\/[^/]+\/file$/],
  // Naming a save, in the game's menu and on the game page.
  ['PUT', /^\/api\/saves\/[^/]+\/meta$/],
]

/** A save's download: the demo lets nobody take a file out. */
const STATIC_DOWNLOADS = /^\/api\/saves\/[^/]+\/download$/

/** The static demo refuses a save's note and pin: naming is all it keeps. */
const STATIC_META = ['title']

/** Whether the static demo refuses this request: everything the demo server refuses, every write playing does not need, and downloads. */
export function demoStaticRefuses(method: string, path: string): boolean {
  if (demoRefuses(method, path)) return true
  if (method === 'GET' || method === 'HEAD') return STATIC_DOWNLOADS.test(path)
  return path.startsWith('/api/') && !STATIC_WRITES.some(([m, p]) => m === method && p.test(path))
}

/** Whether the static demo refuses the body of a save's name: it keeps the title only. */
export function demoStaticRefusesMeta(body: object): boolean {
  return Object.keys(body).some((key) => !STATIC_META.includes(key))
}
