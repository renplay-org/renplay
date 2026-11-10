import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** This server's version, from its package.json. */
export const VERSION = ((): string => {
  try {
    return JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf-8')).version
  } catch {
    return '0.0.0'
  }
})()

/** What Renplay calls itself to renplay.org hosts. */
export const USER_AGENT = `Renplay/${VERSION} (+https://renplay.org)`
