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

/** A save's name is all the static demo keeps of what a visitor writes on it: its note and pin are for a Renplay of your own. */
const STATIC_META = ['title']
const SAVE_META = /^\/api\/saves\/[^/]+\/meta$/

/**
 * Whether the static demo refuses this request: everything the demo server refuses, every write playing does not need, and
 * downloads. `body` is the JSON a write carries, which decides a save's name (the title is kept, a note or a pin is not).
 */
export function demoStaticRefuses(method: string, path: string, body: object = {}): boolean {
  if (demoRefuses(method, path)) return true
  if (method === 'GET' || method === 'HEAD') return STATIC_DOWNLOADS.test(path)
  if (!path.startsWith('/api/') || !STATIC_WRITES.some(([m, p]) => m === method && p.test(path))) return true
  return SAVE_META.test(path) && Object.keys(body).some((key) => !STATIC_META.includes(key))
}
