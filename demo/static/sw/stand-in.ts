/*
 * The demo's service worker, built to /sw.js (the name the library registers). It answers /api/ in the browser
 * (answer.ts) and keeps the visitor's saves and progress in this browser's IndexedDB (idb.ts). Every page of the demo,
 * the library and the game's own frame, is controlled by it, and they share one origin, so they share one store.
 * A change tells every open page to refetch.
 */
/// <reference lib="webworker" />
import { createAnswer } from './answer'
import { fail } from './http'
import { idbStore } from './idb'
import { fromElsewhere } from './origin'
import type { Snapshot } from './types'

declare const self: ServiceWorkerGlobalScope
/** Names the build this worker is of. The build writes the same into the page that starts the library (build.mjs). */
declare const __STAND_IN_VERSION__: string

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
// The page asks which worker controls it before it starts the library. This is the only message the worker takes, and it
// only says what it is.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'renplay-demo:hello') event.source?.postMessage({ type: 'renplay-demo:ready', version: __STAND_IN_VERSION__ })
})
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return
  // Art and avatars are static files of the demo.
  if (/^\/api\/(art|avatars)\//.test(url.pathname)) return
  // A page of another site can send a form to the demo as a navigation, which this worker answers as well.
  if (fromElsewhere(event.request, location.origin)) return event.respondWith(fail(403, 'This request must come from this Renplay'))
  event.respondWith(answer(event.request))
})
