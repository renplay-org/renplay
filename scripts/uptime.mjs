#!/usr/bin/env node
/**
 * Checks Renplay's public sites, and keeps one open GitHub issue (label "uptime") for each site that
 * is down or whose certificate is about to end, closed with a note when it is fine again. Run by .github/workflows/uptime.yml.
 *
 *   node scripts/uptime.mjs              the sites
 *   node scripts/uptime.mjs --demo       the demo (hourly: more often keeps Render's free plan awake)
 *   node scripts/uptime.mjs --all        both
 *   node scripts/uptime.mjs --test       opens and closes a test issue, to check the alerting works
 *   --dry-run                            says what it would do on GitHub, does nothing there
 *
 * A failed check is tried once more after 15 seconds before the site counts as down. The script
 * itself exits 0 when a site is down: the issue is the alert, not a failed run.
 */
import { execFileSync } from 'node:child_process'
import { connect } from 'node:tls'

const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry-run')
const LABEL = 'uptime'
const CERT_DAYS = 14

const page = (text) => async (res) => res.status === 200 && (await res.text()).includes(text) ? null : `answered ${res.status} without "${text}"`
const json = (ok) => async (res) => {
  if (res.status !== 200) return `answered ${res.status}`
  try {
    return ok(await res.json()) ? null : 'answered without its content'
  } catch {
    return 'answered with something that is not JSON'
  }
}

const SITES = [
  { name: 'renplay.org', url: 'https://renplay.org/', check: page('Renplay') },
  { name: 'www.renplay.org', url: 'https://www.renplay.org/catalog', redirect: 'manual',
    check: async (res) => (res.status === 301 && res.headers.get('location') === 'https://renplay.org/catalog' ? null : `answered ${res.status}, not a redirect to renplay.org`) },
  { name: 'docs.renplay.org', url: 'https://docs.renplay.org/', check: page('Renplay docs') },
  { name: 'catalog.renplay.org', url: 'https://catalog.renplay.org/index.v4.json', check: json((d) => d.schema === 4 && d.games?.length > 0) },
  { name: 'engines.renplay.org', url: 'https://engines.renplay.org/index.json', check: engines },
]
const DEMO = [{ name: 'demo.renplay.org', url: 'https://demo.renplay.org/api/health', timeout: 120_000, check: json((d) => d.ok === true) }]

// The index, and every file of the newest engine where the index says it is.
async function engines(res) {
  if (res.status !== 200) return `answered ${res.status}`
  const index = await res.json().catch(() => null)
  const newest = index?.engines?.[0]
  if (!newest) return 'lists no engines'
  for (const [name, file] of Object.entries(newest.files)) {
    const head = await fetch(file.url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(20_000) }).catch((e) => ({ status: e.message }))
    if (head.status !== 200) return `${newest.version}/${name} answered ${head.status}`
  }
  return null
}

function certificateDays(host) {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 443, servername: host, timeout: 20_000 }, () => {
      const until = new Date(socket.getPeerCertificate().valid_to).getTime()
      socket.end()
      resolve(Math.floor((until - Date.now()) / 86_400_000))
    })
    socket.on('error', () => resolve(null))
    socket.on('timeout', () => { socket.destroy(); resolve(null) })
  })
}

async function problem(site) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 15_000))
    let found
    try {
      const res = await fetch(site.url, { redirect: site.redirect ?? 'follow', cache: 'no-store', signal: AbortSignal.timeout(site.timeout ?? 30_000) })
      found = await site.check(res)
    } catch (e) {
      found = `did not answer (${e.cause?.code ?? e.message})`
    }
    if (!found) {
      const days = await certificateDays(new URL(site.url).hostname)
      if (days !== null && days < CERT_DAYS) return `its certificate ends in ${days} days`
      return null
    }
    if (attempt) return `${site.url} ${found}`
  }
}

const gh = (...a) => execFileSync('gh', a, { encoding: 'utf8' })
const run = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : 'a local run'
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

function github(action, ...a) {
  if (DRY) {
    console.log(`  would ${action}`)
    return '[]'
  }
  return gh(...a)
}

function ensureLabel() {
  github(`make sure the "${LABEL}" label exists`, 'label', 'create', LABEL, '--color', 'd73a4a', '--description', 'A public Renplay site is down', '--force')
}

if (args.has('--test')) {
  ensureLabel()
  const url = github('open a test issue', 'issue', 'create', '--title', 'Uptime check test', '--label', LABEL, '--body', `A test of the uptime alerts from ${run}. It closes by itself.`).trim()
  if (!DRY) gh('issue', 'close', url, '--comment', 'The test worked: the uptime check can open and close issues.')
  console.log('Opened and closed a test issue', url)
  process.exit(0)
}

const sites = args.has('--all') ? [...SITES, ...DEMO] : args.has('--demo') ? DEMO : SITES
const results = await Promise.all(sites.map(async (site) => ({ site, problem: await problem(site) })))
const open = JSON.parse(DRY ? '[]' : gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,title', '--limit', '100'))
let labelled = false
for (const { site, problem: found } of results) {
  const title = `Uptime: ${site.name}`
  const issue = open.find((i) => i.title === title)
  console.log(`${found ? 'DOWN' : 'up  '} ${site.name}${found ? `: ${found}` : ''}`)
  if (found && !issue) {
    if (!labelled) { ensureLabel(); labelled = true }
    github(`open "${title}"`, 'issue', 'create', '--title', title, '--label', LABEL, '--body', `${site.name}: ${found}. Found at ${now()} by ${run}. This issue closes by itself when ${site.name} is fine again.`)
  } else if (!found && issue) {
    github(`close #${issue.number}`, 'issue', 'close', String(issue.number), '--comment', `${site.name} is fine again (${now()}).`)
  }
}
