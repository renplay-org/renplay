import { createServer } from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.zip': 'application/zip', '.pack': 'application/octet-stream', '.wasm': 'application/wasm' }

/** The rules of a _headers file: a path pattern, then its headers indented under it. */
function readRules(dir) {
  const file = join(dir, '_headers')
  if (!existsSync(file)) return []
  const rules = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^\S/.test(line)) rules.push({ pattern: line.trim(), headers: {} })
    else if (line.trim() && rules.length) { const i = line.indexOf(':'); rules.at(-1).headers[line.slice(0, i).trim()] = line.slice(i + 1).trim() }
  }
  return rules
}
const matches = (pattern, path) => (pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path)

/**
 * Serves a static output the way the host does: the files as they are, the headers of its _headers file, Range requests,
 * and index.html for an address that is a page and not a file (the single page app fallback).
 */
export async function serveStatic(dir, port = 0) {
  const rules = readRules(dir)
  const requests = []
  /** Paths whose answer is held back, in milliseconds: a slow download. */
  const delays = new Map()
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    requests.push(path)
    if (delays.has(path)) setTimeout(() => respond(req, res, path), delays.get(path))
    else respond(req, res, path)
  })
  const respond = (req, res, path) => {
    let file = join(dir, normalize(path).replace(/^(\.\.[/\\])+/, ''))
    if (path.endsWith('/')) file = join(file, 'index.html')
    let servedPath = path
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (!(req.headers['sec-fetch-mode'] === 'navigate' || req.headers.accept?.includes('text/html'))) return void res.writeHead(404).end('Not found')
      file = join(dir, 'index.html')
      servedPath = '/index.html'
    }
    const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes' }
    for (const rule of rules) if (matches(rule.pattern, path) || matches(rule.pattern, servedPath)) Object.assign(headers, Object.fromEntries(Object.entries(rule.headers).map(([k, v]) => [k.toLowerCase(), v])))
    const size = statSync(file).size
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      if (start >= size) return void res.writeHead(416, { 'content-range': `bytes */${size}` }).end()
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
      return void createReadStream(file, { start, end }).pipe(res)
    }
    res.writeHead(200, { ...headers, 'content-length': size })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(file).pipe(res)
  }
  await new Promise((done) => server.listen(port, '127.0.0.1', done))
  return { port: server.address().port, requests, delays, close: () => new Promise((done) => server.close(done)) }
}

// node static-demo-server.mjs <dir> [port]: the same server by hand, at http://localhost:<port> (a secure context).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port } = await serveStatic(resolve(process.argv[2] ?? 'dist'), Number(process.argv[3] ?? 5191))
  console.log(`http://localhost:${port}`)
}
