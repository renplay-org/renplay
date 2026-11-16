import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { noindexProblems } from './noindex-host.mjs'

const GOOD = {
  'robots.txt': 'User-agent: *\nAllow: /\n',
  '_headers': '/*\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex, nofollow\n',
  'index.html': '<html><head><meta name="robots" content="noindex, nofollow"></head></html>',
  '404.html': '<html><head><meta name="robots" content="noindex"></head></html>',
}

/** What the check says about a built host with these files, over the good ones. */
function problems(files) {
  const dist = mkdtempSync(join(tmpdir(), 'noindex-host-'))
  try {
    for (const [name, text] of Object.entries({ ...GOOD, ...files })) {
      if (text === null) continue
      mkdirSync(dirname(join(dist, name)), { recursive: true })
      writeFileSync(join(dist, name), text)
    }
    return noindexProblems(dist, 'host')
  } finally {
    rmSync(dist, { recursive: true, force: true })
  }
}

test('a host that lets crawlers in and says noindex in its header and every page passes', () => {
  assert.deepEqual(problems({}), [])
})
test('a robots.txt that blocks crawling fails, since the noindex is never read', () => {
  for (const robots of ['User-agent: *\nDisallow: /\n', 'User-agent: *\nAllow: /\nDisallow: /private/\n']) assert.match(problems({ 'robots.txt': robots }).join(), /robots\.txt blocks crawling/)
  assert.deepEqual(problems({ 'robots.txt': 'User-agent: *\nDisallow:\n' }), [])
})
test('a missing robots.txt fails', () => {
  assert.match(problems({ 'robots.txt': null }).join(), /robots\.txt is missing/)
})
test('a page without noindex fails, in any folder', () => {
  assert.match(problems({ 'index.html': '<html><head></head></html>' }).join(), /index\.html has no robots meta/)
  assert.match(problems({ 'catalog/index.html': '<html><head><meta name="robots" content="index, follow"></head></html>' }).join(), /catalog\/index\.html has no robots meta/)
})
test('a missing header for every path fails, and so does one for another path', () => {
  assert.match(problems({ '_headers': null }).join(), /X-Robots-Tag/)
  assert.match(problems({ '_headers': '/*\n  X-Content-Type-Options: nosniff\n/img/*\n  X-Robots-Tag: noindex\n' }).join(), /X-Robots-Tag/)
})
