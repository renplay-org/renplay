#!/usr/bin/env node
// Chooses what a pull request's CI runs, from the files it changes. The rules are plain and ordered: the first rule
// that matches a file says what that file can affect, and the pull request runs the union. A file no rule knows runs
// everything, and so do deleted and renamed files (but a screenshot or a text, which nothing loads), a release into
// main, a manual run, a ci:full label and RENPLAY_CI_FULL=true. When in doubt it runs more, never less.
//
//   node scripts/ci-select.mjs < files.tsv              prints the choice as JSON
//   node scripts/ci-select.mjs --github < files.tsv     also writes the job outputs and the job summary
//
// Input: one file per line, `status<TAB>path<TAB>previous path` (the last two columns as the pull request's file list
// has them), or just a path. Environment: BASE_REF, EVENT, CI_LABELS (comma separated) and RENPLAY_CI_FULL.
import { appendFileSync, readFileSync } from 'node:fs'

/**
 * What a kind of file can affect.
 *   app       'all' runs every browser spec, 'website' only the website's spec
 *   layout    the layout check of the website and the docs
 *   image     the install contract and the chart on kind
 *   server    the server's type checks and tests (check)
 *   telemetry the telemetry collector's job
 * Everything else (structure, design, copy, runtime syntax, docs, website, chart and workflow lint) is cheap and always runs.
 */
const NOTHING = {}
const EVERYTHING = { app: 'all', layout: true, image: true, server: true, telemetry: true }

/** [name, pattern, what it affects, may be deleted or renamed without running everything] */
const RULES = [
  // Tools every browser job and the pipeline stand on.
  ['pipeline', /^(\.github\/workflows\/ci\.yml|mise\.toml|tasks\.toml|package(-lock)?\.json|(server|selector)\/package(-lock)?\.json|server\/scripts\/app-ui\/(playwright\.config|summary-reporter|serve|global-setup)\.mjs)/, EVERYTHING],
  // The scripts that only check text or releases are checked by check itself.
  ['repository checks', /^scripts\/(check-(copy|design|structure|website)(\.test)?\.mjs|release\.mjs|package-chart\.py|ci-select(\.test)?\.mjs)$/, NOTHING],
  ['browser tooling', /^scripts\//, EVERYTHING],
  // Texts that nothing loads. The configuration page is read by a server test, so it is not among them.
  ['configuration page', /^docs\/site\/src\/content\/docs\/configuration\.md$/, { server: true }],
  // The layout check opens the docs' home page and one guide, so a change to that guide's text can change what it measures.
  ['docs page the layout check opens', /^docs\/site\/src\/content\/docs\/start-here\/quick-start\.md$/, { layout: true }],
  ['docs text', /^docs\/site\/src\/content\/docs\/.*\.md$/, NOTHING],
  ['docs tooling', /^docs\/site\/scripts\//, { layout: true, server: true }],
  ['docs site', /^docs\/site\//, { layout: true }],
  ['texts', /^(README|CONTRIBUTING|AGENTS|CLAUDE|CODE_OF_CONDUCT|CHANGELOG)\.md$|^LICENSE$|^docs\/(screenshots\/|logo)|^image\/.*\.md$|^charts\/renplay\/(README\.md|README\.md\.gotmpl|artifacthub-repo\.yml)$|^\.agents\/|^\.claude$|^\.github\/(CODEOWNERS|SECURITY\.md|PULL_REQUEST_TEMPLATE\.md|ISSUE_TEMPLATE\/|dependabot\.yml)/, NOTHING, true],
  // The website has one browser spec, which builds it, and its own layout check.
  ['website', /^website\//, { app: 'website', layout: true }],
  ['telemetry', /^telemetry\//, { telemetry: true }],
  // Other workflows publish and deploy. Nothing in a pull request's checks runs them (actionlint and zizmor read them).
  ['other workflows', /^\.github\/workflows\//, NOTHING],
  ['server unit tests', /^server\/src\/__tests__\/[^/]+\.test\.ts$/, { server: true }, true],
  ['configuration', /^server\/src\/envvars\.ts$/, { app: 'all', layout: true, image: true, server: true }],
  ['image inputs', /^(Dockerfile|\.dockerignore|image\/|charts\/|tests\/|deploy\/compose\.yaml$)/, { image: true }],
  ['deploy examples', /^deploy\//, NOTHING],
  ['design', /^design\//, { app: 'all', layout: true, image: true, server: true }],
  // The website's spec and its fixture are read by that spec alone.
  ['website spec', /^server\/scripts\/app-ui\/(specs\/website\.spec|website-fixture)\.mjs$/, { app: 'website' }],
  ['browser specs', /^server\/scripts\/app-ui\//, { app: 'all' }],
  ['static demo', /^demo\//, { app: 'all', server: true }],
  ['app', /^(selector|runtime|server)\//, { app: 'all', image: true, server: true }],
]

/** The shape of the browser jobs. One entry per job: its name, the suite for scripts/test-ui.sh and the Playwright arguments. */
export const BROWSER_JOBS = {
  playwright: [{ name: 'playwright', suite: 'playwright', args: '' }],
  website: { name: 'website', suite: 'playwright', args: 'website.spec' },
  layout: { name: 'layout', suite: 'layout', args: '' },
}

/** A cut file list (a pull request shows at most 3000 files) cannot be judged. */
const MAX_FILES = 3000

const parse = (text) => text.split('\n').filter(Boolean).map((line) => {
  const [a, b, c] = line.split('\t')
  return b === undefined ? { status: 'modified', path: a, previous: '' } : { status: a, path: b, previous: c ?? '' }
})

const ruleFor = (path) => RULES.find(([, pattern]) => pattern.test(path))

/** What each changed file affects: the rule's name and effect, or everything for a file no rule knows. */
function classify({ status, path, previous }) {
  const moved = status === 'removed' || status === 'renamed'
  const found = ruleFor(path)
  if (!found) return { path, rule: 'unknown file', effect: EVERYTHING }
  if (moved) {
    // A deleted or renamed file can break whatever loaded it. Texts and unit tests are loaded by nothing that a browser runs.
    const old = previous && previous !== path ? ruleFor(previous) : found
    if (!found[3] || !old?.[3]) return { path, rule: `${status === 'removed' ? 'deleted' : 'renamed'} file (${found[0]})`, effect: EVERYTHING }
  }
  return { path, rule: found[0], effect: found[2] }
}

/**
 * @param {{ files: { status: string, path: string, previous: string }[], base?: string, event?: string, labels?: string[], full?: boolean }} input
 */
export function select({ files, base = 'dev', event = 'pull_request', labels = [], full = false }) {
  const reasons = []
  let forced = ''
  if (event !== 'pull_request') forced = `not a pull request (${event})`
  else if (base === 'main') forced = 'a release into main runs everything'
  else if (full) forced = 'RENPLAY_CI_FULL is true'
  else if (labels.includes('ci:full')) forced = 'the ci:full label is set'
  else if (files.length === 0) forced = 'no changed files were listed'
  else if (files.length >= MAX_FILES) forced = `${files.length} files, and the list may be cut`
  const picked = forced ? [{ path: 'every file', rule: forced, effect: EVERYTHING }] : files.map(classify)
  const affects = { app: '', layout: false, image: false, server: false, telemetry: false }
  const because = { app: [], layout: [], image: [], server: [], telemetry: [] }
  for (const { path, rule, effect } of picked) {
    for (const key of Object.keys(affects)) {
      if (!effect[key]) continue
      affects[key] = key === 'app' && (effect.app === 'all' || affects.app === 'all') ? 'all' : key === 'app' ? effect.app : true
      because[key].push(`${path} (${rule})`)
    }
  }
  const browser = [
    ...(affects.app === 'all' ? BROWSER_JOBS.playwright : affects.app === 'website' ? [BROWSER_JOBS.website] : []),
    ...(affects.layout ? [BROWSER_JOBS.layout] : []),
  ]
  const lines = (key) => because[key].length ? `${because[key].slice(0, 3).join(', ')}${because[key].length > 3 ? ` and ${because[key].length - 3} more` : ''}` : ''
  reasons.push(
    ['Browser specs', affects.app === 'all' ? 'all' : affects.app === 'website' ? 'the website spec only' : 'none', lines('app')],
    ['Layout check', affects.layout ? 'runs' : 'skipped', lines('layout')],
    ['Install contract', affects.image ? 'runs' : 'skipped', lines('image')],
    ['Server type checks and tests', affects.server ? 'run' : 'skipped', lines('server')],
    ['Telemetry', affects.telemetry ? 'runs' : 'skipped', lines('telemetry')],
  )
  return { browser, image: affects.image, server: affects.server, telemetry: affects.telemetry, forced, reasons, files: picked }
}

function main() {
  const github = process.argv.includes('--github')
  const result = select({
    files: parse(readFileSync(0, 'utf8')),
    base: process.env.BASE_REF || 'dev',
    event: process.env.EVENT || 'pull_request',
    labels: (process.env.CI_LABELS || '').split(',').map((l) => l.trim()).filter(Boolean),
    full: process.env.RENPLAY_CI_FULL === 'true',
  })
  const { browser, image, server, telemetry, forced, reasons, files } = result
  console.log(JSON.stringify({ browser, image, server, telemetry, forced }))
  if (!github) return
  appendFileSync(process.env.GITHUB_OUTPUT, [
    `browser-suites=${JSON.stringify(browser)}`, `image=${image}`, `server=${server}`, `telemetry=${telemetry}`,
  ].map((l) => `${l}\n`).join(''))
  const summary = [
    '## What this run covers', '',
    forced ? `Everything runs: ${forced}.` : `${files.length} changed files, chosen by the rules in scripts/ci-select.mjs.`, '',
    '| Part | This run | Because |', '| --- | --- | --- |',
    ...reasons.map(([part, what, why]) => `| ${part} | ${what} | ${(forced ? forced : why || 'nothing changed that it reads').replaceAll('|', '/')} |`), '',
    'Always run: structure, design, copy, runtime syntax, docs, website, chart and workflow checks, and the examples.', '',
  ].join('\n')
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
