import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The runtime/ folder: next to server/ in the repository and in the image (/app/runtime). */
const RUNTIME_DIR = fileURLToPath(new URL('../../../runtime/', import.meta.url))

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
 * each one's own script (the HTML games' in two parts, their media first). One function holds
 * both, so nothing of the shared part is global.
 */
export function readRuntimes(): Runtimes {
  const read = (name: string) => readFileSync(join(RUNTIME_DIR, name), 'utf-8')
  const player = read('renplay-player.js')
  const wrap = (own: string) =>
    `;(function () {\n'use strict'\n// A page that loads the runtime twice keeps the first.\nif (window.__renplayPlayer) return\nwindow.__renplayPlayer = true\n${player}\n${own}\n})()\n`
  const renpy = wrap(read('renplay-runtime.js'))
  // Inside a script tag: a closing tag in the text would end it.
  const html = `${read('vendor/fake-indexeddb.js')}\n;\n${wrap(`${read('renplay-html-media.js')}\n${read('renplay-html.js')}`)}`.replace(/<\/script/gi, '<\\/script')
  return { renpy, html, version: createHash('sha1').update(renpy).digest('hex').slice(0, 10) }
}
