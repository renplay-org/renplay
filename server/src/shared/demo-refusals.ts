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
