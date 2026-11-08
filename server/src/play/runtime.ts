import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The repository's runtime/ folder, when RENPLAY_RUNTIME_PATH does not name another. */
const IN_REPOSITORY = fileURLToPath(new URL('../../../runtime/renplay-runtime.js', import.meta.url))

export interface Runtimes {
  /** Ren'Py's, served at /renplay/runtime.js. */
  renpy: string
  /** The HTML games', inlined in their pages: the in-memory IndexedDB, then the runtime. */
  html: string
  /** Ren'Py's changes it, so browsers fetch the runtime again after an upgrade. */
  version: string
}

/**
 * Builds the two in-game runtimes from runtime/: renplay-player.js, what both share, in front of
 * each one's own script. One function holds both, so nothing of the shared part is global.
 */
export function readRuntimes(runtimePath = IN_REPOSITORY): Runtimes {
  const read = (name: string) => readFileSync(join(dirname(runtimePath), name), 'utf-8')
  const player = read('renplay-player.js')
  const wrap = (own: string) =>
    `;(function () {\n'use strict'\n// A page that loads the runtime twice keeps the first.\nif (window.__renplayPlayer) return\nwindow.__renplayPlayer = true\n${player}\n${own}\n})()\n`
  const renpy = wrap(readFileSync(runtimePath, 'utf-8'))
  // Inside a script tag: a closing tag in the text would end it.
  const html = `${read('vendor/fake-indexeddb.js')}\n;\n${wrap(read('renplay-html.js'))}`.replace(/<\/script/gi, '<\\/script')
  return { renpy, html, version: createHash('sha1').update(renpy).digest('hex').slice(0, 10) }
}
