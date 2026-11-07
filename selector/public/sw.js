/*
 * Renplay's service worker. The library opens without a network, and a game kept offline plays from
 * this browser's copy. Online, everything comes from the server as before: pages and answers are
 * fetched first and the copy is only used when the server cannot be reached.
 *
 * Caches:
 * - renplay-shell-v1: the library itself (index.html and its /assets/ files).
 * - renplay-api-v1: the last answers of a few routes the library and the player read. Never saves:
 *   the game's own offline queue (IndexedDB) handles those, with the conflict rule.
 * - renplay-offline-<game>: a kept game's page, engine, build files and streamed files, and its art.
 * - renplay-gamezip-v1: the runtime's game.zip cache, which a kept game's game.zip goes into.
 */
'use strict'

const SHELL = 'renplay-shell-v1'
const API = 'renplay-api-v1'
const KEPT = 'renplay-offline-'
const GAMEZIP = 'renplay-gamezip-v1'

/** Answers kept for offline: who is signed in, the library, a game, and the defaults. */
const ANSWERS = /^\/api\/(me|auth\/providers|defaults|content|games|games\/[a-z0-9][a-z0-9._-]*)$/

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/** The games kept in this browser, read from the caches' names. */
let kept = null
function keptGames() {
  if (!kept) kept = caches.keys().then((names) => new Set(names.filter((n) => n.startsWith(KEPT)).map((n) => n.slice(KEPT.length))))
  return kept
}
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'renplay:kept-changed') kept = null
})

/** One form of each address, so a file is found however its name was encoded. */
function keyOf(url) {
  const path = url.pathname
    .split('/')
    .map((part) => {
      try {
        return encodeURIComponent(decodeURIComponent(part))
      } catch {
        return part
      }
    })
    .join('/')
  return url.origin + path + url.search
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const path = url.pathname
  if (req.method !== 'GET') {
    // Another person, or nobody: the last answers were someone else's.
    if (/^\/api\/auth\/(login|logout|switch)$/.test(path)) event.waitUntil(caches.delete(API))
    return
  }
  if (path.startsWith('/g/')) {
    const id = path.split('/')[2]
    event.respondWith(fromKept(req, url, id))
  } else if (path.startsWith('/engine/') || path === '/renplay/runtime.js' || path.startsWith('/api/art/')) {
    event.respondWith(fromKept(req, url, null))
  } else if (path.startsWith('/assets/')) {
    event.respondWith(shellFile(req))
  } else if (/^\/(favicon\.svg|manifest\.webmanifest|apple-touch-icon\.png|icon-(192|512)\.png)$/.test(path)) {
    event.respondWith(answer(req, SHELL))
  } else if (req.mode === 'navigate' && !path.startsWith('/api/')) {
    event.respondWith(shellPage(req))
  } else if (ANSWERS.test(path)) {
    event.respondWith(answer(req))
  }
})

/** The library's page: from the server, or the last one seen. */
async function shellPage(req) {
  try {
    const res = await fetch(req)
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
      const copy = res.clone()
      caches.open(SHELL).then((c) => c.put('/index.html', copy)).catch(() => {})
    }
    return res
  } catch (e) {
    const hit = await caches.match('/index.html', { cacheName: SHELL, ignoreVary: true })
    if (hit) return hit
    throw e
  }
}

/** The library's files are named by their content, so a copy is always right. */
async function shellFile(req) {
  const cache = await caches.open(SHELL)
  // Vite's files are crossorigin requests, and the server may answer with Vary: Origin.
  const hit = await cache.match(req, { ignoreVary: true })
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone()).catch(() => {})
  return res
}

/** An answer from the server, or the last one when the server cannot be reached. */
async function answer(req, cacheName = API) {
  try {
    const res = await fetch(req)
    if (res.ok) {
      const copy = res.clone()
      caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {})
    }
    return res
  } catch (e) {
    const hit = await caches.match(req, { cacheName, ignoreVary: true })
    if (hit) return hit
    throw e
  }
}

/**
 * A file of a kept game (or the engine or art one uses). Builds never change, so the copy is served
 * first. The game's page is made for the person each time: from the server, the copy when offline.
 */
async function fromKept(req, url, id) {
  const games = await keptGames()
  if (!games.size || (id && !games.has(id))) return fetch(req)
  const key = keyOf(url)
  const names = id ? [KEPT + id] : [...games].map((g) => KEPT + g)
  if (id && /\/game\.zip$/.test(url.pathname)) names.push(GAMEZIP)
  const find = async () => {
    for (const name of names) {
      const hit = await caches.match(key, { cacheName: name, ignoreVary: true })
      if (hit) return hit
    }
    return null
  }
  if (id && /^\/g\/[^/]+\/[^/]+\/(index\.html)?$/.test(url.pathname)) {
    try {
      const res = await fetch(req)
      if (res.ok && !res.redirected) {
        const copy = res.clone()
        caches.open(KEPT + id).then((c) => c.put(key, copy)).catch(() => {})
      }
      return res
    } catch (e) {
      const hit = await find()
      if (hit) return hit
      throw e
    }
  }
  const hit = await find()
  if (!hit) return fetch(req)
  const range = req.headers.get('range')
  return range ? part(hit, range) : hit
}

/** A byte range of a kept file: videos seek with ranges, and a cache keeps whole files. */
async function part(res, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m || (m[1] === '' && m[2] === '')) return res
  const blob = await res.blob()
  const size = blob.size
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1])
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  })
}
