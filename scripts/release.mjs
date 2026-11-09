#!/usr/bin/env node
/**
 * Prepares a release branch, or checks one (CI's release-check).
 *
 *   node scripts/release.mjs 4.4.0          versions, chart, deploy/ files, changelog
 *   node scripts/release.mjs check 4.4.0    everything above says 4.4.0
 *
 * The chart's Artifact Hub category must be one Artifact Hub knows, or it skips the version. Its
 * changes are written from the changelog when the chart is published (package-chart.py).
 *
 * The version it replaces is the one in server/package.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const REPO = 'https://github.com/renplay-org/renplay'
const SEMVER = /^\d+\.\d+\.\d+$/
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const read = (path) => readFileSync(path, 'utf8')
const write = (path, text) => writeFileSync(path, text)

/** Each place a release names its version: the file, and the text around the version. */
const PLACES = [
  ['charts/renplay/Chart.yaml', (v) => `\nversion: ${v}\n`],
  ['charts/renplay/Chart.yaml', (v) => `\nappVersion: "${v}"\n`],
  ['charts/renplay/Chart.yaml', (v) => `image: ghcr.io/renplay-org/renplay:${v}\n`],
  ['deploy/compose.yaml', (v) => `image: ghcr.io/renplay-org/renplay:${v}\n`],
  ['deploy/caddy/compose.yaml', (v) => `image: ghcr.io/renplay-org/renplay:${v}\n`],
  ['deploy/kubernetes/values.yaml', (v) => `oci://ghcr.io/renplay-org/charts/renplay --version ${v} `],
  ['deploy/kubernetes/app-template.yaml', (v) => `repository: ghcr.io/renplay-org/renplay\n          tag: ${v}\n`],
]
const PACKAGES = ['server', 'selector']
const CHART = 'charts/renplay/Chart.yaml'

/** Artifact Hub's categories (artifacthub.io/docs/topics/annotations/helm). */
const CATEGORIES = ['ai-machine-learning', 'analytics', 'data-processing', 'database', 'integration-delivery', 'monitoring-logging', 'networking', 'security', 'storage', 'streaming-messaging', 'web-applications', 'skip-prediction']
function check(version) {
  const problems = []
  for (const dir of PACKAGES) {
    if (JSON.parse(read(`${dir}/package.json`)).version !== version) problems.push(`${dir}/package.json is not at ${version}`)
    const lock = JSON.parse(read(`${dir}/package-lock.json`))
    if (lock.version !== version || lock.packages[''].version !== version) problems.push(`${dir}/package-lock.json is not at ${version}`)
  }
  for (const [path, around] of PLACES) {
    if (!read(path).includes(around(version))) problems.push(`${path} does not have ${JSON.stringify(around(version).trim())}`)
  }
  const changelog = read('CHANGELOG.md')
  if (!new RegExp(`^## \\[${esc(version)}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) problems.push(`CHANGELOG.md needs a "## [${version}] - YYYY-MM-DD" section`)
  if (!changelog.includes(`\n[Unreleased]: ${REPO}/compare/v${version}...dev\n`)) problems.push(`CHANGELOG.md's [Unreleased] link must compare v${version}...dev`)
  if (!new RegExp(`^\\[${esc(version)}\\]: ${esc(REPO)}/compare/v\\d+\\.\\d+\\.\\d+\\.\\.\\.v${esc(version)}$`, 'm').test(changelog)) problems.push(`CHANGELOG.md needs a [${version}] compare link`)
  const chart = read(CHART)
  const category = chart.match(/^  artifacthub\.io\/category: (.+)$/m)?.[1]
  if (category && !CATEGORIES.includes(category)) problems.push(`${CHART}: artifacthub.io/category ${category} is not one of Artifact Hub's: ${CATEGORIES.join(', ')}`)
  return problems
}

function prepare(version) {
  const old = JSON.parse(read('server/package.json')).version
  if (old === version) throw new Error(`server/package.json is at ${version} already`)
  // npm writes its JSON with two spaces and a final newline. Writing it the same way changes only the versions.
  for (const dir of PACKAGES) {
    const pkg = JSON.parse(read(`${dir}/package.json`))
    pkg.version = version
    write(`${dir}/package.json`, `${JSON.stringify(pkg, null, 2)}\n`)
    const lock = JSON.parse(read(`${dir}/package-lock.json`))
    lock.version = lock.packages[''].version = version
    write(`${dir}/package-lock.json`, `${JSON.stringify(lock, null, 2)}\n`)
  }
  for (const [path, around] of PLACES) {
    const text = read(path)
    if (!text.includes(around(old))) throw new Error(`${path} does not have ${JSON.stringify(around(old).trim())}`)
    write(path, text.replace(around(old), around(version)))
  }
  const today = new Date().toISOString().slice(0, 10)
  let changelog = read('CHANGELOG.md')
  if (!changelog.includes('\n## [Unreleased]\n')) throw new Error('CHANGELOG.md has no "## [Unreleased]" section')
  changelog = changelog
    .replace('\n## [Unreleased]\n', `\n## [Unreleased]\n\n## [${version}] - ${today}\n`)
    .replace(`\n[Unreleased]: ${REPO}/compare/v${old}...dev\n`, `\n[Unreleased]: ${REPO}/compare/v${version}...dev\n[${version}]: ${REPO}/compare/v${old}...v${version}\n`)
  write('CHANGELOG.md', changelog)
  const problems = check(version)
  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`Ready for ${version} (from ${old}). Read the ${version} section of CHANGELOG.md, then commit "chore: release ${version}".`)
}

const [first, second] = process.argv.slice(2)
const checking = first === 'check'
const version = checking ? second : first
if (!version || !SEMVER.test(version)) {
  console.error('Usage: node scripts/release.mjs <X.Y.Z> | check <X.Y.Z>')
  process.exit(2)
}
try {
  if (checking) {
    const problems = check(version)
    if (problems.length) {
      console.error(problems.join('\n'))
      process.exit(1)
    }
    console.log(`Everything says ${version}.`)
  } else {
    prepare(version)
  }
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
