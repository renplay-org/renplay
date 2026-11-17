#!/usr/bin/env node
// Print the browser jobs whose inputs changed. Shared tooling always runs all three.
import { readFileSync } from 'node:fs'

const files = readFileSync(0, 'utf8').split('\n').filter(Boolean)
const shared = files.some((p) =>
  /^(scripts\/|\.github\/workflows\/|mise\.toml$|tasks\.toml$|server\/package(-lock)?\.json$)/.test(p) ||
  /^server\/scripts\/app-ui\/(playwright\.config|summary-reporter|serve)\.mjs$/.test(p))
// The website has a browser spec of its own (website.spec.mjs, which builds the website), so a change to it runs the specs too.
const app = shared || files.some((p) => /^(selector\/|design\/|server\/|runtime\/|tests\/|demo\/static\/|website\/)/.test(p))
const layout = shared || files.some((p) => /^(website\/|docs\/|design\/|server\/src\/envvars\.ts$)/.test(p))
console.log(JSON.stringify([...(app ? ['playwright'] : []), ...(layout ? ['layout'] : [])]))
