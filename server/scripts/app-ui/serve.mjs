import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../../../selector/dist', import.meta.url))

/** The built library only. No real server or game data is reachable here. */
export async function serveDist(port = 0) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png', '.mjs': 'text/javascript', '.wasm': 'application/wasm' }
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = await readFile(join(dist, path)).then((b) => ({ b, type: types[extname(path)] ?? 'application/octet-stream' })).catch(() => null)
    const sent = file ?? { b: await readFile(join(dist, 'index.html')), type: 'text/html' }
    res.writeHead(200, { 'content-type': sent.type }).end(sent.b)
  })
  await new Promise((done) => server.listen(port, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await serveDist(4179)
