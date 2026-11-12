import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

const command = new URL('./browser-suites.mjs', import.meta.url)
const suites = (...paths) => JSON.parse(execFileSync(process.execPath, [command.pathname], { input: paths.join('\n'), encoding: 'utf8' }))

test('app and runtime inputs select both library runners', () => {
  for (const path of ['selector/src/App.tsx', 'server/src/shared/api.ts', 'runtime/renplay-runtime.js', 'tests/contract.py', 'server/scripts/app-ui/specs/search.spec.mjs']) {
    assert.deepEqual(suites(path), ['legacy', 'playwright'], path)
  }
})
test('site inputs select layout, including generated configuration inputs', () => {
  for (const path of ['website/style.css', 'docs/site/astro.config.mjs']) assert.deepEqual(suites(path), ['layout'], path)
  assert.deepEqual(suites('server/src/envvars.ts'), ['legacy', 'playwright', 'layout'])
})
test('shared scripts, workflows and tool pins always select everything', () => {
  for (const path of [
    'scripts/test-ui.sh', 'scripts/test-ui-container.sh', 'scripts/check-layout-shift.mjs',
    '.github/workflows/ci.yml', '.github/workflows/flake-hunt.yml', 'mise.toml', 'tasks.toml',
    'server/package.json', 'server/package-lock.json', 'server/scripts/check-app-ui.mjs',
    'server/scripts/app-ui/lib.mjs', 'server/scripts/app-ui/playwright.config.mjs',
    'server/scripts/app-ui/summary-reporter.mjs', 'server/scripts/app-ui/serve.mjs',
  ]) {
    assert.deepEqual(suites(path), ['legacy', 'playwright', 'layout'], path)
  }
})
test('unrelated changes select none, mixed changes select the union', () => {
  assert.deepEqual(suites('README.md', 'telemetry/src/index.ts', 'charts/renplay/values.yaml'), [])
  assert.deepEqual(suites('selector/src/App.tsx', 'docs/site/package-lock.json'), ['legacy', 'playwright', 'layout'])
})
