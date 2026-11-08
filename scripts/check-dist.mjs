#!/usr/bin/env node
// Checks the built library (selector/dist) for what a build step can silently drop. Chromium reads
// only the unprefixed backdrop-filter: with just the -webkit- form left, every glass surface lost
// its blur there (4.2). Run after `npm run build` in selector.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = new URL('../selector/dist/assets/', import.meta.url).pathname
const problems = []
for (const name of readdirSync(dir).filter((n) => n.endsWith('.css'))) {
  const css = readFileSync(join(dir, name), 'utf8')
  // Each rule body, with its prefixed and unprefixed blur.
  for (const [, body] of css.matchAll(/\{([^{}]*)\}/g)) {
    const prefixed = /-webkit-backdrop-filter\s*:/.test(body)
    const plain = /(^|[;\s])backdrop-filter\s*:/.test(body)
    if (prefixed && !plain) problems.push(`${name}: a rule has -webkit-backdrop-filter without backdrop-filter: {${body.slice(0, 80)}}`)
  }
}
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('The built library keeps its backdrop filters.')
