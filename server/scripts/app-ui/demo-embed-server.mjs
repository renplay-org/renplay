import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import yazl from 'yazl'

/** Real accounts, cookies and saves with an isolated library. No deployed server is reachable. */
export async function demoEmbedServer() {
  const { createApp } = await import('../../dist/app.js')
  const { loadConfig } = await import('../../dist/config.js')
  const root = await mkdtemp(join(tmpdir(), 'renplay-embed-browser-'))
  let demoUrl = ''
  const host = createServer((_req, res) => res.end(`<!doctype html><html><body style="margin:0">
    <script>window.messages=[]; addEventListener('message', e => { if(e.origin===${JSON.stringify('DEMO_ORIGIN')}) messages.push({ ...e.data, frame: e.source===document.querySelector('#laptop').contentWindow ? 'laptop' : 'phone' }) })</script>
    <iframe id="laptop" title="Laptop" width="880" height="700" src="${demoUrl}/?embed=laptop"></iframe>
    <iframe id="phone" title="Phone" width="390" height="844" src="${demoUrl}/game/the-question?embed=phone"></iframe>
  </body></html>`.replace('DEMO_ORIGIN', demoUrl)))
  await new Promise((done) => host.listen(0, '127.0.0.1', done))
  const hostUrl = `http://127.0.0.1:${host.address().port}`
  const cfg = { ...loadConfig(), demo: true, demoEmbedder: hostUrl, auth: 'on', adultGames: 'off', dataDir: join(root, 'data'), gamesDir: join(root, 'games'), internalDir: join(root, 'internal'), workDir: join(root, 'work'), purgeDir: join(root, 'purge'), uploadsDir: join(root, 'uploads'), enginesDir: join(root, 'engines'), archivesDir: join(root, 'archives'), recipesDir: join(root, 'recipes'), walkthroughsDir: join(root, 'walkthroughs'), overlaysDir: join(root, 'overlays'), catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', backupDir: null, telemetry: 'off' }
  const app = await createApp(cfg, { startJobs: false })
  app.db.insertGame({ id: 'the-question', title: 'The Question', recipe_id: 'the-question', adult: 0, status: 'installed', build: 'b1', engine: '8.5.3', save_dir: 'the-question' })
  app.app.use(express.static(new URL('../../../selector/dist/', import.meta.url).pathname))
  app.app.get('/{*path}', (_req, res) => res.sendFile(new URL('../../../selector/dist/index.html', import.meta.url).pathname))
  const server = app.app.listen(0, '127.0.0.1')
  await new Promise((done) => server.once('listening', done))
  demoUrl = `http://127.0.0.1:${server.address().port}`
  const wrongHost = createServer((_req, res) => res.end('<!doctype html><html><body></body></html>'))
  await new Promise((done) => wrongHost.listen(0, '127.0.0.1', done))
  const zip = new yazl.ZipFile(), chunks = []
  const time = Math.floor(Date.now() / 1000)
  zip.addBuffer(Buffer.from(JSON.stringify({ _save_name: 'A shared scene', _ctime: time, _renpy_version: [8, 5, 3] })), 'json')
  zip.addBuffer(Buffer.from('fixture-log'), 'log')
  zip.outputStream.on('data', (chunk) => chunks.push(chunk))
  const completed = new Promise((done) => zip.outputStream.on('end', done))
  zip.end(); await completed
  const save = [...Buffer.concat(chunks)]
  // A small engine stand-in, like player-fixture.mjs. The app, play response policy, player
  // message validation and authenticated binary save route all remain real.
  app.engines.template = async () => `<!doctype html><html><head></head><body>
    <button id="save" style="position:absolute;left:40%;top:50%;padding:16px">Make a save</button><script>
    document.querySelector('#save').onclick = async () => {
      const response = await fetch('/api/saves/the-question/file?path=the-question/1-1-LT1.save', { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(${JSON.stringify(save)}) })
      window.lastSaveStatus = response.status
      parent.postMessage({ type: 'renplay:sync', pending: 0, online: true, lastSync: Date.now() }, location.origin)
    }
    parent.postMessage({ type: 'renplay:ready' }, location.origin)
    </script></body></html>`
  return {
    url: hostUrl, demoUrl, wrongUrl: `http://127.0.0.1:${wrongHost.address().port}`, time: time * 1000,
    close: async () => { await Promise.all([new Promise((done) => server.close(done)), new Promise((done) => host.close(done)), new Promise((done) => wrongHost.close(done))]); app.close(); await rm(root, { recursive: true, force: true }) },
  }
}
