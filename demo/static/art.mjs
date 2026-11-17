// The art the static demo's output must hold: every picture an answer or a game page names. The stand-in leaves
// /api/art/* to the host, so a picture the output lacks is a 404 for the visitor.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ART = /\/api\/art\/[\w.-]+/g

/** The art addresses the texts name, each once. */
export const artNamed = (...texts) => [...new Set(texts.flatMap((text) => text.match(ART) ?? []))]

/**
 * Fails when an answer of the finished output names art the output lacks. It reads the output itself (the snapshot and
 * each game's page), not what the capture meant to copy, so a gap anywhere between them is found.
 * @param {string} out
 */
export function checkArt(out) {
  const texts = [readFileSync(join(out, 'demo/snapshot.json'), 'utf8')]
  const games = join(out, 'g')
  if (existsSync(games)) {
    for (const id of readdirSync(games)) for (const build of readdirSync(join(games, id))) texts.push(readFileSync(join(games, id, build, 'index.html'), 'utf8'))
  }
  const missing = artNamed(...texts).filter((address) => !existsSync(join(out, address)))
  if (missing.length) throw new Error(`The answers name ${missing.length} art file${missing.length === 1 ? '' : 's'} the output does not have: ${missing.join(', ')}`)
}
