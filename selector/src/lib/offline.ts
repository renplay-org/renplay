import { useSyncExternalStore } from 'react'
import { api } from './api'
import type { Game } from '@shared/api'
import type { OfflineManifest } from '@shared/api'
import { isAppleTouch, isStandalone } from './platform'
import { bytes } from '@shared/format'

/*
 * Keeping a game offline: its files go into this browser's Cache Storage, where the service worker
 * (public/sw.js) finds them when the server cannot be reached. Ren'Py games only. Saves need nothing
 * here: the game keeps unsent saves on the device and sends them when the server is back.
 */

const KEPT = 'renplay-offline-'
const GAMEZIP = 'renplay-gamezip-v1'
const SHELL = 'renplay-shell-v1'
const API = 'renplay-api-v1'
const STATE = 'renplay:offline'

/** A game kept in this browser: its build, size, and when it was kept. */
interface KeptGame {
  build: string
  bytes: number
  at: string
}

export function keptGames(): Record<string, KeptGame> {
  try {
    const v = JSON.parse(localStorage.getItem(STATE) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function keptGame(id: string): KeptGame | null {
  return keptGames()[id] ?? null
}

function setKept(id: string, value: KeptGame | null): void {
  const all = keptGames()
  if (value) all[id] = value
  else delete all[id]
  try {
    localStorage.setItem(STATE, JSON.stringify(all))
  } catch {}
  window.dispatchEvent(new Event('renplay:offline'))
}

/** Whether the browser has a network. A server that cannot be reached on a network shows as errors instead. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (on) => {
      window.addEventListener('online', on)
      window.addEventListener('offline', on)
      return () => {
        window.removeEventListener('online', on)
        window.removeEventListener('offline', on)
      }
    },
    () => navigator.onLine,
  )
}

/**
 * Whether this browser can keep games: 'home-screen' means only from Renplay on the Home Screen.
 * iPhone and iPad keep site data only for Home Screen apps: a Safari tab loses it after a week.
 */
export function offlineSupport(): 'ok' | 'browser' | 'home-screen' {
  if (!('caches' in window) || !('serviceWorker' in navigator) || !window.isSecureContext) return 'browser'
  if (isAppleTouch() && !isStandalone()) return 'home-screen'
  return 'ok'
}

/**
 * One form of each address, the service worker's too, so a file is found however it was encoded. The
 * device's adult level is not part of it. A mod build streams its base build's files, so they are
 * kept once for both, and changing mods downloads only the game itself again.
 */
function keyOf(url: string): string {
  const u = new URL(url, location.origin)
  const path = u.pathname
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
  u.searchParams.delete('adult')
  return u.origin + path + u.search
}

/** The worker reads the kept games again (also when this page is not controlled, after a hard reload). */
function tellWorker(): void {
  navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: 'renplay:kept-changed' })).catch(() => {})
}

/**
 * Downloads a file into a cache, resuming with byte ranges when the connection drops (long downloads
 * through some gateways do). Counts bytes as they arrive.
 */
async function download(url: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<Response> {
  let received = 0
  let failures = 0
  const first = await fetch(url, { signal, cache: 'no-store', credentials: 'same-origin' })
  if (!first.ok || !first.body) throw new Error(`The server answered ${first.status} for ${decodeURIComponent(url.split('/').pop() ?? url)}`)
  const total = Number(first.headers.get('content-length')) || 0
  let reader = first.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            // A connection that closed early is not a whole file.
            if (total && received < total) throw new Error(`${url} ended at ${received} of ${total} bytes`)
            controller.close()
            return
          }
          received += value.byteLength
          onBytes(value.byteLength)
          controller.enqueue(value)
          return
        } catch (e) {
          if (signal.aborted || ++failures > 8 || !total) throw e
          await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** failures)))
          const res = await fetch(url, { signal, cache: 'no-store', credentials: 'same-origin', headers: { Range: `bytes=${received}-` } })
          if (res.status !== 206 || !res.body || !(res.headers.get('content-range') ?? '').startsWith(`bytes ${received}-`)) throw new Error(`Could not resume ${url} (${res.status})`)
          reader = res.body.getReader()
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  const headers = new Headers({ 'Content-Type': first.headers.get('content-type') ?? 'application/octet-stream' })
  if (total) headers.set('Content-Length', String(total))
  return new Response(body, { status: 200, headers })
}

/** One tab at a time keeps or removes a game: another tab's tidying would delete files this one is fetching. */
async function alone<T>(id: string, run: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return run()
  return navigator.locks.request(KEPT + id, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('Another tab or window is keeping this game right now. Try again when it is done.')
    return run()
  })
}

/**
 * The library's own files, from the build's list of them (asset-manifest.json): every page opens
 * offline, also the ones not visited yet, and files of an older build go. Run when a game is kept,
 * and at each start while one is, so a new version of Renplay is kept too.
 */
export async function refreshShell(signal?: AbortSignal): Promise<void> {
  const shell = await caches.open(SHELL)
  const index = await fetch('/', { cache: 'no-store', signal })
  if (index.ok) await shell.put('/index.html', index)
  for (const url of ['/favicon.svg', '/manifest.webmanifest', '/apple-touch-icon.png']) await shell.add(url).catch(() => {})
  const res = await fetch('/asset-manifest.json', { cache: 'no-store', signal })
  if (!res.ok) return
  const chunks = Object.values((await res.json()) as Record<string, { file?: string; css?: string[]; assets?: string[] }>)
  const wanted = new Set<string>()
  for (const c of chunks) for (const f of [c.file, ...(c.css ?? []), ...(c.assets ?? [])]) if (f?.startsWith('assets/')) wanted.add(new URL(`/${f}`, location.origin).toString())
  if (!wanted.size) return
  for (const url of wanted) if (!(await shell.match(url, { ignoreVary: true }))) await shell.add(url).catch(() => {})
  for (const req of await shell.keys()) if (new URL(req.url).pathname.startsWith('/assets/') && !wanted.has(req.url)) await shell.delete(req)
}

/**
 * Keeps a game in this browser: the library's own files, the game's page, engine, build and every
 * streamed file, its pictures and the answers the player reads. Files already kept are skipped, so a
 * stopped download continues where it was. An older build's files go once the new one is complete.
 */
export function keep(game: Game, signal: AbortSignal, onProgress: (done: number, total: number) => void): Promise<void> {
  return alone(game.id, () => keepNow(game, signal, onProgress))
}

async function keepNow(game: Game, signal: AbortSignal, onProgress: (done: number, total: number) => void): Promise<void> {
  const m = await api<OfflineManifest>(`/api/games/${encodeURIComponent(game.id)}/offline`)
  const cache = await caches.open(KEPT + game.id)
  const zips = await caches.open(GAMEZIP)
  tellWorker()
  const files = m.files.map((f) => ({ ...f, key: f.url.endsWith('/game.zip') ? new URL(f.url, location.origin).toString() : keyOf(f.url), zip: f.url.endsWith('/game.zip') }))
  const pictures = Object.values(game.art ?? {}).flatMap((a) => [a?.url1x, a?.url2x]).filter((u): u is string => !!u)
  for (const url of new Set(pictures)) files.push({ url, bytes: 0, key: keyOf(url), zip: false })
  const missing: typeof files = []
  for (const f of files) if (!(await (f.zip ? zips : cache).match(f.key))) missing.push(f)
  const total = m.bytes
  let done = total - missing.reduce((n, f) => n + f.bytes, 0)
  onProgress(done, total)

  // Room: ask the browser to keep this data, and check there is space before a long download.
  await navigator.storage?.persist?.().catch(() => false)
  const est = await navigator.storage?.estimate?.().catch(() => null)
  const need = total - done
  if (est?.quota && est.quota - (est.usage ?? 0) < need * 1.05) {
    throw new Error(`This browser has room for ${bytes(est.quota - (est.usage ?? 0))} more, and the game needs ${bytes(need)}.`)
  }

  // The library's own files, so Renplay opens with no network.
  await refreshShell(signal)
  // The answers the library and the player read.
  const answers = await caches.open(API)
  for (const url of ['/api/me', '/api/me/adult', '/api/auth/providers', '/api/defaults', '/api/content', '/api/games', `/api/games/${encodeURIComponent(game.id)}`]) {
    const res = await fetch(url, { cache: 'no-store', signal }).catch(() => null)
    if (res?.ok) await answers.put(url, res)
  }

  // The game: a few files at a time, each tried again before giving up.
  let next = 0
  const worker = async () => {
    while (next < missing.length) {
      const f = missing[next++]!
      for (let attempt = 1; ; attempt++) {
        let counted = 0
        try {
          const res = await download(f.url, signal, (n) => {
            counted += n
            done += n
            onProgress(done, total)
          })
          await (f.zip ? zips : cache).put(f.key, res)
          break
        } catch (e) {
          done -= counted
          if (signal.aborted || attempt >= 4) throw e
          await new Promise((r) => setTimeout(r, 2000 * attempt))
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))

  // Complete: files of another build or engine go.
  const wanted = new Set(files.filter((f) => !f.zip).map((f) => f.key))
  for (const req of await cache.keys()) if (!wanted.has(keyOf(req.url))) await cache.delete(req)
  for (const req of await zips.keys()) if (req.url.includes(`/g/${game.id}/`) && req.url !== files.find((f) => f.zip)?.key) await zips.delete(req)
  setKept(game.id, { build: m.build, bytes: total, at: new Date().toISOString() })
  tellWorker()
}

/** Removes a kept game from this browser. Saves are not touched: they live in the game's own storage. */
export function removeKept(id: string): Promise<void> {
  return alone(id, () => removeNow(id))
}

async function removeNow(id: string): Promise<void> {
  await caches.delete(KEPT + id)
  const zips = await caches.open(GAMEZIP)
  for (const req of await zips.keys()) if (req.url.includes(`/g/${id}/`)) await zips.delete(req)
  setKept(id, null)
  tellWorker()
}
