import { execFile } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import yazl from 'yazl'
import { serveStatic } from './static-demo-server.mjs'

const run = promisify(execFile)
const repo = new URL('../../../', import.meta.url).pathname

/** The website's side: a page with the laptop and the phone, relaying `saved` from one frame as `refresh` to the other. */
async function embedder(port, demoOrigin) {
  const page = `<!doctype html><html><body style="margin:0">
    <script>
      const demo = ${JSON.stringify(demoOrigin)}
      window.messages = []
      addEventListener('message', (e) => {
        if (e.origin !== demo) return
        const laptop = document.querySelector('#laptop').contentWindow, phone = document.querySelector('#phone').contentWindow
        if (e.source !== laptop && e.source !== phone) return
        messages.push({ ...e.data, frame: e.source === laptop ? 'laptop' : 'phone' })
        if (e.data?.type === 'renplay-embed:saved') (e.source === laptop ? phone : laptop).postMessage({ type: 'renplay-embed:refresh' }, demo)
      })
    </script>
    <iframe id="laptop" title="Laptop" width="880" height="700" allow="fullscreen" src="${demoOrigin}/?embed=laptop"></iframe>
    <iframe id="phone" title="Phone" width="390" height="844" allow="fullscreen" src="${demoOrigin}/game/the-question?embed=phone"></iframe>
  </body></html>`
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(page))
  await new Promise((done) => server.listen(port, '127.0.0.1', done))
  return { close: () => new Promise((done) => server.close(done)) }
}

/**
 * The static demo, served for a test, with an embedder page that frames it. Without `dir` the demo is built here from a
 * demo server with one game and a stand-in engine (a button that makes a save). With `dir`, that finished output (the
 * real demo's, with its real game) is served instead, copied so its embedder can be the one of this test.
 */
export async function staticDemo({ dir } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'renplay-static-demo-'))
  // Both addresses are decided first: the build names the embedder, and the page names the demo.
  const host = createServer()
  await new Promise((done) => host.listen(0, '127.0.0.1', done))
  const embedderPort = host.address().port
  await new Promise((done) => host.close(done))
  const embedderOrigin = `http://localhost:${embedderPort}`
  const out = join(root, 'out')
  let server
  if (dir) {
    cpSync(dir, out, { recursive: true })
    for (const [file, from] of [['_headers', 'https://renplay.org'], ['demo/snapshot.json', 'https://renplay.org']]) writeFileSync(join(out, file), readFileSync(join(out, file), 'utf8').replaceAll(from, embedderOrigin))
  } else {
    const { createApp } = await import('../../dist/app.js')
    const { loadConfig } = await import('../../dist/config.js')
    const cfg = { ...loadConfig(), demo: true, demoEmbedder: embedderOrigin, auth: 'on', adultGames: 'off', dataDir: join(root, 'data'), gamesDir: join(root, 'games'), internalDir: join(root, 'internal'), workDir: join(root, 'work'), purgeDir: join(root, 'purge'), uploadsDir: join(root, 'uploads'), enginesDir: join(root, 'engines'), archivesDir: join(root, 'archives'), recipesDir: join(root, 'recipes'), walkthroughsDir: join(root, 'walkthroughs'), overlaysDir: join(root, 'overlays'), catalogUrls: ['http://127.0.0.1:9/none'], enginesUrl: 'http://127.0.0.1:9/none', backupDir: null, telemetry: 'off' }
    const app = await createApp(cfg, { startJobs: false })
    app.db.insertGame({ id: 'the-question', title: 'The Question', recipe_id: 'the-question', adult: 0, status: 'installed', build: 'b1', engine: '8.5.3', save_dir: 'the-question' })
    app.engines.template = async () => '<!doctype html><html><head></head><body><script src="renpy-pre.js"></script></body></html>'
    const source = app.app.listen(0, '127.0.0.1')
    await new Promise((done) => source.once('listening', done))
    // The seed: the files of the game's build, as the demo image's seed stage has them.
    const seed = join(root, 'seed', 'games', 'the-question', 'b1')
    mkdirSync(seed, { recursive: true })
    writeFileSync(join(seed, 'game.zip'), 'zip')
    writeFileSync(join(seed, 'assets.pack'), 'xxpng0123456789')
    writeFileSync(join(seed, 'assets.json'), JSON.stringify({ 'images/a.png': [2, 3] }))
    try {
      await run(process.execPath, [join(repo, 'demo/static/build.mjs'), out, '--seed', join(root, 'seed'), '--base', `http://127.0.0.1:${source.address().port}`, '--embedder', embedderOrigin], { maxBuffer: 1 << 24 })
    } finally {
      await new Promise((done) => source.close(done))
      app.close()
    }
    await writeStandInEngine(out)
  }
  server = await serveStatic(out)
  const origin = `http://localhost:${server.port}`
  const page = await embedder(embedderPort, origin)
  return {
    origin, port: server.port, embedderOrigin, requests: server.requests, delays: server.delays, dir: out,
    close: async () => { await Promise.all([server.close(), page.close()]); rmSync(root, { recursive: true, force: true }) },
  }
}

/** A Ren'Py save as the game writes it: a zip with a json and a log. */
export async function renpySave(name, ctime) {
  const zip = new yazl.ZipFile(), chunks = []
  zip.addBuffer(Buffer.from(JSON.stringify({ _save_name: name, _ctime: ctime, _renpy_version: [8, 5, 3] })), 'json')
  zip.addBuffer(Buffer.from('fixture-log'), 'log')
  zip.outputStream.on('data', (c) => chunks.push(c))
  const ended = new Promise((done) => zip.outputStream.on('end', done))
  zip.end()
  await ended
  return Buffer.concat(chunks)
}

/** In the built game page, a small engine stand-in with a button that saves the way the runtime does, instead of the engine and its runtime. */
async function writeStandInEngine(out) {
  const save = [...(await renpySave('A shared scene', Math.floor(Date.now() / 1000)))]
  const dir = join(out, 'g', 'the-question', 'b1')
  const file = join(dir, 'index.html')
  const stub = `<button id="save" style="position:absolute;left:40%;top:50%;padding:16px">Make a save</button><script>
    document.querySelector('#save').onclick = async () => {
      const response = await fetch('/api/saves/the-question/file?path=the-question/1-1-LT1.save', { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(${JSON.stringify(save)}) })
      window.lastSaveStatus = response.status
      parent.postMessage({ type: 'renplay:sync', pending: 0, online: true, lastSync: Date.now() }, location.origin)
    }
    parent.postMessage({ type: 'renplay:ready' }, location.origin)
  </script>`
  const page = readFileSync(file, 'utf8')
  const boot = page.indexOf('<script>window.__renplay=')
  const end = page.indexOf('window.__renplayLate()</script>') + 'window.__renplayLate()</script>'.length
  if (boot < 0 || end < boot) throw new Error('The built game page has no boot scripts')
  writeFileSync(file, page.slice(0, boot) + stub + page.slice(end))
}
