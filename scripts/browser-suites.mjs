#!/usr/bin/env node
// Print the browser jobs whose inputs changed. Shared tooling always runs all three.
import { readFileSync } from 'node:fs'

const files = readFileSync(0, 'utf8').split('\n').filter(Boolean)
const shared = files.some((p) =>
  /^(scripts\/|\.github\/workflows\/|mise\.toml$|tasks\.toml$|server\/package(-lock)?\.json$)/.test(p) ||
  /^server\/scripts\/(check-app-ui\.mjs|app-ui\/(lib|playwright\.config|summary-reporter|serve)\.mjs)$/.test(p))
const app = shared || files.some((p) => /^(selector\/|server\/|runtime\/|tests\/)/.test(p))
const layout = shared || files.some((p) => /^(website\/|docs\/|server\/src\/envvars\.ts$)/.test(p))
console.log(JSON.stringify([...(app ? ['legacy', 'playwright'] : []), ...(layout ? ['layout'] : [])]))
