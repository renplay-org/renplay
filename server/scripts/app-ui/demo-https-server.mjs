import { execFileSync } from 'node:child_process'
import { createServer } from 'node:https'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'

/**
 * The demo and its embedder over HTTPS, with a self-signed certificate and made-up names that a
 * browser can be told to resolve (see `hostRules`). The embedder is on the demo's own site
 * (www.renplay.test, like renplay.org) or on another (other.test). Real accounts and cookies, an
 * isolated library, no deployed server.
 */
const SITE = 'www.renplay.test', OTHER = 'other.test', DEMO = 'demo.renplay.test'
export const hostNames = [DEMO, SITE, OTHER]
export const hostRules = `MAP *.test 127.0.0.1`

export async function demoHttpsServer({ embedder = 'same-site' } = {}) {
  const { createApp } = await import('../../dist/app.js')
  const { loadConfig } = await import('../../dist/config.js')
  const root = await mkdtemp(join(tmpdir(), 'renplay-https-browser-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=renplay.test', '-addext', `subjectAltName=${hostNames.map((name) => `DNS:${name}`).join(',')}`, '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem')], { stdio: 'ignore' })
  const tls = { key: await readFile(join(root, 'key.pem')), cert: await readFile(join(root, 'cert.pem')) }
  const listen = async (handler) => {
    const server = createServer(tls, handler)
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    return server
  }
  let demoUrl = ''
  // What the website does: one key for this visitor, in its own storage, handed to both frames in the fragment.
  const page = () => `<!doctype html><html><body style="margin:0">
    <iframe id="laptop" title="Laptop" width="880" height="700"></iframe>
    <iframe id="phone" title="Phone" width="390" height="844"></iframe>
    <script>
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const key = localStorage.getItem('renplay-visitor') ?? btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    localStorage.setItem('renplay-visitor', key)
    window.visitor = key
    document.querySelector('#laptop').src = '${demoUrl}/?embed=laptop#visitor=' + key
    document.querySelector('#phone').src = '${demoUrl}/game/the-question?embed=phone#visitor=' + key
    </script></body></html>`
  const embedderServer = await listen((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(page()))
  const embedderUrl = `https://${embedder === 'same-site' ? SITE : OTHER}:${embedderServer.address().port}`
  const base = loadConfig()
  const cfg = { ...base, demo: true, demoEmbedder: embedderUrl, auth: 'on', adultGames: 'off', dataDir: join(root, 'data'), gamesDir: join(root, 'games'), internalDir: join(root, 'internal'), workDir: join(root, 'work'), purgeDir: join(root, 'purge'), uploadsDir: join(root, 'uploads'), enginesDir: join(root, 'engines'), archivesDir: join(root, 'archives'), recipesDir: join(root, 'recipes'), walkthroughsDir: join(root, 'walkthroughs'), overlaysDir: join(root, 'overlays'), catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', backupDir: null, telemetry: 'off', trustedHops: 0 }
  const app = await createApp(cfg, { startJobs: false })
  app.db.insertGame({ id: 'the-question', title: 'The Question', recipe_id: 'the-question', adult: 0, status: 'installed', build: 'b1', engine: '8.5.3', save_dir: 'the-question' })
  app.app.use(express.static(new URL('../../../selector/dist/', import.meta.url).pathname))
  app.app.get('/{*path}', (_req, res) => res.sendFile(new URL('../../../selector/dist/index.html', import.meta.url).pathname))
  const demoServer = await listen(app.app)
  demoUrl = `https://${DEMO}:${demoServer.address().port}`
  // The public address is what makes the cookies Secure, as the demo image sets it.
  cfg.publicUrl = demoUrl
  return {
    demoUrl, embedderUrl, app,
    close: async () => { await Promise.all([demoServer, embedderServer].map((s) => new Promise((done) => s.close(done)))); app.close(); await rm(root, { recursive: true, force: true }) },
  }
}
