import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { select } from './ci-select.mjs'

const file = (path, status = 'modified', previous = '') => ({ path, status, previous })
const pick = (paths, options = {}) => {
  const files = paths.map((p) => (typeof p === 'string' ? file(p) : p))
  const r = select({ files, ...options })
  return { browser: r.browser.map((b) => b.name), image: r.image, server: r.server, telemetry: r.telemetry, forced: r.forced }
}
const EVERYTHING = { browser: ['playwright', 'layout'], image: true, server: true, telemetry: true }
const everything = (r, why) => assert.deepEqual({ ...r, forced: undefined }, { ...EVERYTHING, forced: undefined }, why)

test('texts that nothing loads run no browser, no contract and no server tests', () => {
  const r = pick(['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'CHANGELOG.md', 'image/README.md', 'charts/renplay/README.md', 'charts/renplay/README.md.gotmpl',
    'docs/screenshots/desktop-game.webp', 'docs/site/src/content/docs/faq.md', '.agents/skills/release/SKILL.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/workflows/release.yml'])
  assert.deepEqual(r, { browser: [], image: false, server: false, telemetry: false, forced: '' })
})

test('pull request 217 (readmes, chart texts, a release job, screenshots added and removed) runs no browser suite', () => {
  const r = pick([file('.github/workflows/release.yml'), file('AGENTS.md'), file('charts/renplay/README.md.gotmpl'), file('docs/screenshots/desktop-catalog.webp', 'added'),
    file('docs/screenshots/desktop-library.webp', 'removed'), file('image/README.md', 'added')])
  assert.deepEqual(r.browser, [])
  assert.equal(r.server, false)
})

test('the configuration page is read by a server test, the other docs are not', () => {
  assert.deepEqual(pick(['docs/site/src/content/docs/configuration.md']), { browser: [], image: false, server: true, telemetry: false, forced: '' })
  assert.equal(pick(['docs/site/scripts/gen-config.mjs']).server, true)
  assert.deepEqual(pick(['docs/site/scripts/gen-config.mjs']).browser, ['layout'])
})

test('docs code and docs pages that are not plain text select the layout check only', () => {
  for (const path of ['docs/site/astro.config.mjs', 'docs/site/src/content/docs/index.mdx', 'docs/site/package-lock.json', 'docs/site/src/components/Card.astro']) {
    assert.deepEqual(pick([path]).browser, ['layout'], path)
  }
})

test('every docs page the layout check opens selects the layout check when its text changes', () => {
  const layout = readFileSync(new URL('./check-layout-shift.mjs', import.meta.url), 'utf8')
  const pages = [...layout.matchAll(/\$\{docs\}\/([a-z0-9/-]+)\//g)].map((m) => m[1])
  assert.ok(pages.length >= 1, 'the layout check opens at least one docs guide')
  for (const page of pages) assert.deepEqual(pick([`docs/site/src/content/docs/${page}.md`]).browser, ['layout'], page)
})

test('the website alone runs its own spec and the layout check', () => {
  for (const path of ['website/site.css', 'website/js/home.js', 'website/index.html']) {
    const r = select({ files: [file(path)] })
    assert.deepEqual(r.browser, [{ name: 'website', suite: 'playwright', args: 'website.spec' }, { name: 'layout', suite: 'layout', args: '' }], path)
    assert.equal(r.image, false)
    assert.equal(r.server, false)
  }
})

test('the website spec and its fixture run that spec alone, and other specs run them all', () => {
  for (const path of ['server/scripts/app-ui/specs/website.spec.mjs', 'server/scripts/app-ui/website-fixture.mjs']) {
    assert.deepEqual(pick([path]), { browser: ['website'], image: false, server: false, telemetry: false, forced: '' }, path)
  }
  assert.deepEqual(pick(['server/scripts/app-ui/specs/pad.spec.mjs', 'server/scripts/app-ui/website-fixture.mjs']).browser, PLAYWRIGHT)
})

test('the library, the runtime, the server and the design run every browser spec', () => {
  for (const path of ['selector/src/App.tsx', 'runtime/renplay-runtime.js', 'server/src/play/runtime.ts', 'server/src/shared/api.ts', 'demo/static/sw/answer.ts', 'design/tokens.css']) {
    const r = pick([path])
    assert.ok(r.browser.includes('playwright'), path)
    assert.equal(r.server, true, path)
  }
  // A browser spec is read by Playwright alone: the server's own tests do not run it.
  assert.deepEqual(pick(['server/scripts/app-ui/specs/search.spec.mjs']), { browser: ['playwright'], image: false, server: false, telemetry: false, forced: '' })
  assert.deepEqual(pick(['selector/src/App.tsx']).browser, ['playwright'])
  assert.deepEqual(pick(['design/tokens.css']).browser, ['playwright', 'layout'])
  assert.deepEqual(pick(['server/src/envvars.ts']).browser, ['playwright', 'layout'])
})

test('the pipeline and the browser tooling run everything', () => {
  for (const path of ['.github/workflows/ci.yml', 'mise.toml', 'tasks.toml', 'package.json', 'server/package.json', 'server/package-lock.json', 'selector/package-lock.json',
    'server/scripts/app-ui/playwright.config.mjs', 'server/scripts/app-ui/summary-reporter.mjs', 'server/scripts/app-ui/serve.mjs',
    'scripts/test-ui.sh', 'scripts/test-ui-container.sh', 'scripts/ui-workspace.mjs', 'scripts/check-layout-shift.mjs']) {
    everything(pick([path]), path)
  }
})

test('scripts that only check text or releases, and server unit tests, run no browser', () => {
  for (const path of ['scripts/check-copy.mjs', 'scripts/check-structure.mjs', 'scripts/check-design.mjs', 'scripts/release.mjs', 'scripts/ci-select.mjs', 'scripts/ci-select.test.mjs']) {
    assert.deepEqual(pick([path]).browser, [], path)
  }
  assert.deepEqual(pick(['server/src/__tests__/art.test.ts']), { browser: [], image: false, server: true, telemetry: false, forced: '' })
  assert.deepEqual(pick([file('server/src/__tests__/art.test.ts', 'removed')]).browser, [])
})

test('the image and the chart run the contract, nothing else', () => {
  for (const path of ['Dockerfile', '.dockerignore', 'image/entrypoint.sh', 'charts/renplay/values.yaml', 'charts/renplay/templates/deployment.yaml', 'tests/contract.py', 'deploy/compose.yaml']) {
    assert.deepEqual(pick([path]), { browser: [], image: true, server: false, telemetry: false, forced: '' }, path)
  }
  assert.equal(pick(['deploy/caddy/Caddyfile']).image, false)
})

test('the telemetry collector runs its own job and nothing else', () => {
  assert.deepEqual(pick(['telemetry/src/validate.ts', 'telemetry/package-lock.json']), { browser: [], image: false, server: false, telemetry: true, forced: '' })
})

test('a file no rule knows runs everything', () => {
  for (const path of ['.gitignore', '.githooks/pre-push', 'something-new/file.txt', 'Makefile']) everything(pick([path]), path)
})

test('deleted and renamed files run everything, except texts and unit tests that nothing loads', () => {
  everything(pick([file('selector/src/old.tsx', 'removed')]), 'a deleted source file')
  everything(pick([file('website/js/old.js', 'removed')]), 'a deleted website file')
  everything(pick([file('docs/site/src/content/docs/start-here/quick-start.md', 'removed')]), 'a deleted docs page, which the layout check opens')
  everything(pick([file('selector/src/new.tsx', 'renamed', 'selector/src/old.tsx')]), 'a renamed source file')
  everything(pick([file('docs/screenshots/b.webp', 'renamed', 'selector/src/a.tsx')]), 'a source file renamed into a text')
  everything(pick([file('selector/src/a.tsx', 'renamed', 'docs/screenshots/b.webp')]), 'a text renamed into a source file')
  assert.deepEqual(pick([file('docs/screenshots/b.webp', 'removed')]).browser, [])
  assert.deepEqual(pick([file('docs/screenshots/b.webp', 'renamed', 'docs/screenshots/a.webp')]).browser, [])
})

test('a mixed change runs the union', () => {
  assert.deepEqual(pick(['README.md', 'telemetry/src/index.ts', 'charts/renplay/values.yaml']), { browser: [], image: true, server: false, telemetry: true, forced: '' })
  const r = pick(['selector/src/App.tsx', 'docs/site/astro.config.mjs', 'website/index.html'])
  assert.deepEqual(r.browser, ['playwright', 'layout'])
  assert.deepEqual(pick(['website/index.html', 'docs/site/astro.config.mjs']).browser, ['website', 'layout'])
})

test('a release into main, a manual run, the switches and a cut file list run everything', () => {
  const texts = ['README.md']
  everything(pick(texts, { base: 'main' }), 'release')
  everything(pick(texts, { event: 'workflow_dispatch' }), 'manual run')
  everything(pick(texts, { full: true }), 'RENPLAY_CI_FULL')
  everything(pick(texts, { labels: ['ci:full'] }), 'ci:full')
  assert.deepEqual(pick(texts, { labels: ['dependencies'] }).browser, [])
  everything(pick([]), 'no files listed')
  everything(pick(Array.from({ length: 3000 }, (_, i) => `docs/screenshots/${i}.webp`)), 'a list that may be cut')
  assert.match(pick(texts, { base: 'main' }).forced, /release/)
  assert.match(pick(texts, { labels: ['ci:full'] }).forced, /ci:full/)
})

test('the command writes job outputs and a summary that names the reason for each part', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-select-'))
  const output = join(dir, 'output')
  const summary = join(dir, 'summary')
  writeFileSync(output, '')
  writeFileSync(summary, '')
  const command = new URL('./ci-select.mjs', import.meta.url).pathname
  const input = 'modified\tselector/src/App.tsx\t\nmodified\tREADME.md\t\n'
  const env = { PATH: process.env.PATH, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, BASE_REF: 'dev', EVENT: 'pull_request' }
  execFileSync(process.execPath, [command, '--github'], { input, env, encoding: 'utf8' })
  const lines = Object.fromEntries(readFileSync(output, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  assert.deepEqual(JSON.parse(lines['browser-suites']), [{ name: 'playwright', suite: 'playwright', args: '' }])
  assert.equal(lines.image, 'true')
  assert.equal(lines.server, 'true')
  assert.equal(lines.telemetry, 'false')
  const text = readFileSync(summary, 'utf8')
  assert.match(text, /\| Browser specs \| all \| selector\/src\/App\.tsx \(app\)/)
  assert.match(text, /\| Layout check \| skipped \|/)
  execFileSync(process.execPath, [command, '--github'], { input, env: { ...env, RENPLAY_CI_FULL: 'true' }, encoding: 'utf8' })
  assert.match(readFileSync(summary, 'utf8'), /Everything runs: RENPLAY_CI_FULL is true/)
})
