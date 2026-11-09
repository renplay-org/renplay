import { BUILD_RE } from '../games/builds.js'

export interface GamePath {
  game: string
  /** The build's folder name, with its mod suffix when it has one. */
  build: string
  base: string
  /** The hash of the mods applied to the build, when it has any. */
  mod: string | undefined
  /** The capability of a sandboxed page, from /g/<game>/<build>/s/<token>/game/<file>. */
  token: string | undefined
  /** What follows the build, as written in the address: game/<file>, game.zip, cache/<file>. */
  rest: string
}

const GAME_PATH = /^\/g\/([a-z0-9][a-z0-9._-]*)\/([^/]+)\/(?:s\/([A-Za-z0-9_.-]+)\/(?=game\/))?(.*)$/

/** Takes apart /g/<game>/<build>[.m<hash>]/..., or null when the address is not of that shape. */
export function parseGamePath(path: string): GamePath | null {
  const m = GAME_PATH.exec(path)
  const build = m && BUILD_RE.exec(m[2]!)
  if (!m || !build) return null
  return { game: m[1]!, build: m[2]!, base: build[1]!, mod: build[2], token: m[3], rest: m[4]! }
}
