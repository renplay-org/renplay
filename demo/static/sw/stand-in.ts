/*
 * The demo's service worker, built to /sw.js (the name the library registers). It answers /api/ in the browser
 * (answer.ts) and keeps the visitor's saves and progress in this browser's IndexedDB (idb.ts). Every page of the demo,
 * the library and the game's own frame, is controlled by it, and they share one origin, so they share one store.
 * A change tells every open page to refetch.
 */
/// <reference lib="webworker" />
import { createAnswer } from './answer'
import { idbStore } from './idb'
import type { Snapshot } from './types'

declare const self: ServiceWorkerGlobalScope

let snapshot: Promise<Snapshot> | null = null
const answer = createAnswer({
  store: idbStore(),
  snapshot: () => (snapshot ??= fetch('/demo/snapshot.json').then((r) => r.json() as Promise<Snapshot>)),
  notify() {
    void self.clients.matchAll({ includeUncontrolled: true }).then((all) => all.forEach((c) => c.postMessage({ type: 'renplay-demo:changed' })))
  },
})

self.addEventListener('install', () => void self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return
  // Art and avatars are static files of the demo.
  if (/^\/api\/(art|avatars)\//.test(url.pathname)) return
  event.respondWith(answer(event.request))
})
