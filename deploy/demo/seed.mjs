// Seeds the demo's /data at image build time: starts Renplay with a throwaway admin, installs the
// demo's games from /games/_archives with their recipes, waits until their art is made, and stops.
// The admin's password is random and never written down: a demo refuses every sign-in but the guest.
//
//   node seed.mjs <game archive>...
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

const base = 'http://127.0.0.1:3000'
const password = randomBytes(24).toString('base64url')
const archives = process.argv.slice(2)
const server = spawn('node', ['/app/server/dist/index.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: '3000',
    RENPLAY_AUTH: 'on',
    RENPLAY_DEMO: 'off',
    RENPLAY_ADMIN_USERNAME: 'seed',
    RENPLAY_ADMIN_PASSWORD: password,
  },
})
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let cookie = ''
const api = async (path, init = {}) => {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...init.headers },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`)
  return res
}
const until = async (what, test, seconds = 600) => {
  for (let i = 0; i < seconds; i++) {
    const value = await test().catch((e) => {
      if (e.fatal) throw e
      return null
    })
    if (value) return value
    await wait(1000)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

try {
  await until('the server', async () => (await fetch(base + '/api/health')).ok)
  const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'seed', password }) })
  cookie = login.headers.get('set-cookie').split(';')[0]
  await api('/api/catalog/refresh', { method: 'POST' })
  await until('the catalog and Your recipes', async () => (await (await api('/api/catalog')).json()).games.some((g) => g.id === 'the-question'))
  for (const archive of archives) {
    const name = basename(archive)
    const recipeId = name.startsWith('the_question-') ? 'the-question' : undefined
    const { jobId } = await (await api('/api/imports', { method: 'POST', body: JSON.stringify({ source: { kind: 'archive', path: name }, recipeId }) })).json()
    const job = await until(`installing ${name}`, async () => {
      const j = (await (await api('/api/jobs')).json()).jobs.find((x) => x.id === jobId)
      if (j?.status === 'failed') throw Object.assign(new Error(`Installing ${name} failed: ${j.error}`), { fatal: true })
      return j?.status === 'done' ? j : null
    })
    console.log(`seed: installed ${name}, job ${job.id}`)
    await rm(join(process.env.GAMES_DIR ?? '/games', '_archives', name))
  }
  // Every installed game has its poster made, and every format it has is made.
  await until('the art', async () => {
    const games = (await (await api('/api/games')).json()).games.filter((g) => g.status === 'installed')
    return games.length === archives.length && games.every((g) => g.art?.grid?.url1x && Object.values(g.art).every((f) => f.url1x))
  })
  console.log(`seed: art made for ${archives.length} ${archives.length === 1 ? 'game' : 'games'}`)
  console.log('seed: done')
} finally {
  server.kill('SIGTERM')
  await new Promise((r) => server.once('exit', r))
}
