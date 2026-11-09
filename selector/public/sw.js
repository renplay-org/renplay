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

/** How long a page or an answer may take when a copy is there: Wi-Fi without internet waits much longer. */
const WAIT = 6000

/** Answers kept for offline: who is signed in and their adult level, the library, a game, and the defaults. */
const ANSWERS = /^\/api\/(me|me\/adult|auth\/providers|defaults|content|games|games\/[a-z0-9][a-z0-9._-]*)$/

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

/** The games kept in this browser, read from the caches' names. */
let kept = null
function keptGames() {
  if (!kept) {
    kept = caches.keys().then(
      (names) => new Set(names.filter((n) => n.startsWith(KEPT)).map((n) => n.slice(KEPT.length))),
      () => {
        kept = null
        return new Set()
      },
    )
  }
  return kept
}
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'renplay:kept-changed') kept = null
})

/** Counts sign-ins, sign-outs and switches: an answer asked for before one is never kept after it. */
let generation = 0

/**
 * From the server, cached when it answers well. With a copy at hand, a server that does not answer in
 * time or answers with an error (a gateway's 502) counts as unreachable. The download goes on, and
 * its answer still updates the copy.
 */
function network(req, save, hasCopy) {
  const asked = generation
  const answered = fetch(req).then((res) => {
    if (res.ok && save && asked === generation) save(res.clone()).catch(() => {})
    return res
  })
  if (!hasCopy) return answered
  return Promise.race([
    answered.then((res) => {
      if (res.status >= 500) throw new Error(`The server answered ${res.status}`)
      return res
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('The server did not answer in time')), WAIT)),
  ])
}

/**
 * One form of each address, so a file is found however its name was encoded. The device's adult level
 * is not part of it. A mod build streams its base build's files, so they are kept once for both.
 */
function keyOf(url) {
  const path = url.pathname
    .replace(/^(\/g\/[^/]+\/[a-z0-9]+)\.m[a-z0-9]+(\/game\/)/, '$1$2')
    .split('/')
    .map((part) => {
      try {
        return encodeURIComponent(decodeURIComponent(part))
      } catch {
        return part
      }
    })
    .join('/')
  const params = new URLSearchParams(url.search)
  params.delete('adult')
  const search = params.toString()
  return url.origin + path + (search ? `?${search}` : '')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  const path = url.pathname
  // Another person, or nobody: the last answers were someone else's.
  if ((req.method !== 'GET' && /^\/api\/auth\/(login|logout|switch)$/.test(path)) || (req.mode === 'navigate' && path.startsWith('/api/auth/'))) {
    generation++
    event.waitUntil(caches.delete(API))
    return
  }
  if (req.method !== 'GET') return
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
  const hit = await caches.match('/index.html', { cacheName: SHELL, ignoreVary: true })
  const save = (res) => ((res.headers.get('content-type') || '').includes('text/html') ? caches.open(SHELL).then((c) => c.put('/index.html', res)) : Promise.resolve())
  try {
    return await network(req, save, !!hit)
  } catch (e) {
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
  const hit = await caches.match(req, { cacheName, ignoreVary: true })
  try {
    return await network(req, (res) => caches.open(cacheName).then((c) => c.put(req, res)), !!hit)
  } catch (e) {
    if (hit) return hit
    throw e
  }
}

async function cachedAnswer(path) {
  const hit = await caches.match(path, { cacheName: API, ignoreVary: true })
  return hit ? hit.json().catch(() => null) : null
}

/**
 * A kept game's page offline, made for whoever is signed in on this browser now: the page holds the
 * person it was made for, and the game keeps each person's unsent saves apart by it. Without a
 * signed-in person, or a game they may not see, it does not play. At Blurred the game's own
 * presplash gives way to the engine's.
 */
async function offlinePage(hit, id) {
  const [me, answer] = await Promise.all([cachedAnswer('/api/me'), cachedAnswer(`/api/games/${id}`)])
  const user = me && me.user && me.user.id
  if (!Number.isInteger(user) || !answer || !answer.game) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Renplay</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#ccc;font:16px system-ui;text-align:center;padding:24px"><p>Open this game once with a network while you are signed in, and then it plays offline for you.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
  let html = await hit.text()
  html = html.replace(/("userId":)\d+/, `$1${user}`)
  const blurred = answer.game.nsfw && !Object.values(answer.game.art || {}).some((a) => a && a.url1x)
  const engine = /"engineBase":"(\/engine\/[^"]+\/)"/.exec(html)
  if (blurred && engine) html = html.replace(/(<img[^>]*id="presplash"[^>]*src=)"[^"]*"/i, `$1"${engine[1]}web-presplash.jpg"`)
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
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
    const hit = await find()
    // The kept copy's text, read here, because the offline path reads the copy itself.
    const before = hit ? hit.clone().text() : Promise.resolve(null)
    const save = async (res) => {
      if (res.redirected) return
      const text = await res.clone().text()
      await caches.open(KEPT + id).then((c) => c.put(key, res))
      // The copy is the same page: its files are kept already, and the game's whole file list is not walked again.
      if (text !== (await before)) await refreshKept(id, url)
    }
    try {
      return await network(req, save, !!hit)
    } catch (e) {
      if (hit) return offlinePage(hit, id)
      throw e
    }
  }
  const hit = await find()
  if (!hit) return fetch(req)
  const range = req.headers.get('range')
  return range ? part(hit, range) : hit
}

/**
 * After a kept game's page came from the server, the files it names now come too. A new version of
 * Renplay changes the runtime's address, and a game stores compiled caches as it plays. Its game.zip
 * stays as it was kept: a new build is kept again from the library.
 */
async function refreshKept(id, page) {
  const adult = page.searchParams.get('adult')
  const res = await fetch(`/api/games/${encodeURIComponent(id)}/offline${adult ? `?adult=${encodeURIComponent(adult)}` : ''}`, { cache: 'no-store' })
  if (!res.ok) return
  const files = (await res.json()).files || []
  const cache = await caches.open(KEPT + id)
  for (const f of files) {
    const url = new URL(f.url, self.location.origin)
    if (/\/game\.zip$/.test(url.pathname) || (await cache.match(keyOf(url), { ignoreVary: true }))) continue
    const file = await fetch(url.toString(), { cache: 'no-store' }).catch(() => null)
    if (file && file.status === 200) await cache.put(keyOf(url), file)
  }
}

/**
 * A byte range of a kept file: videos seek with ranges, and a cache keeps whole files. Only the range
 * is read through, never the whole file at once: on a phone a video would not fit in memory.
 */
async function part(res, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m || (m[1] === '' && m[2] === '')) return res
  let size = Number(res.headers.get('content-length'))
  let blob = null
  if (!size || !res.body) {
    blob = await res.blob()
    size = blob.size
  }
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1])
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  return new Response(blob ? blob.slice(start, end + 1) : slice(res.body, start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  })
}

/** The bytes from `from` up to `to` of a stream, read as they come and the rest left unread. */
function slice(stream, from, to) {
  const reader = stream.getReader()
  let at = 0
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        const first = at
        at += value.byteLength
        if (at <= from) continue
        controller.enqueue(value.subarray(Math.max(0, from - first), Math.min(value.byteLength, to - first)))
        if (at >= to) {
          controller.close()
          reader.cancel().catch(() => {})
        }
        return
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
}
