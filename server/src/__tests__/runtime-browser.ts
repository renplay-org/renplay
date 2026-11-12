// The in-game runtimes, run whole in node:vm as the server serves them, inside a small fake browser
// and game frame. Tests drive them the way the player and the game do (messages, storage, files)
// and look at what they post to the player and send to the server.
import { runInNewContext } from 'node:vm'
import { expect, vi } from 'vitest'
import { readRuntimes } from '../play/runtime.js'

const runtimes = readRuntimes()
const origin = 'http://renplay.test'

type Fetch = (input: unknown, init?: any) => Promise<Response>
type Listener = (event: any) => void

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

function browser(userId: number, game: string, fetch: Fetch, framed: boolean) {
  const listeners: Record<string, Listener[]> = {}
  const delayed = new Map<number, { fn: (...args: any[]) => void, delay: number, args: any[] }>()
  const intervals: Array<() => void> = []
  const post = vi.fn()
  let nextTimer = -1
  const later = (fn: (...args: any[]) => void, delay = 0, ...args: any[]) => {
    if (delay >= 100) {
      const id = nextTimer--
      delayed.set(id, { fn, delay, args })
      return id
    }
    return setTimeout(fn, delay, ...args)
  }
  const cancel = (id: number) => {
    if (!delayed.delete(id)) clearTimeout(id)
  }
  class MessageChannel {
    port1: { onmessage: null | (() => void) } = { onmessage: null }
    port2 = { postMessage: () => { queueMicrotask(() => this.port1.onmessage?.()) } }
  }
  class Document {
    addEventListener(type: string, listener: Listener) { (listeners[`document:${type}`] ??= []).push(listener) }
  }
  class HTMLMediaElement {
    play() { return Promise.resolve() }
  }
  const document = Object.assign(new Document(), {
    hidden: false,
    visibilityState: 'visible',
    querySelectorAll: () => [],
    createElement: () => ({ click: vi.fn() }),
    getElementById: () => null,
    body: { appendChild: vi.fn() },
  })
  const parent = { postMessage: post }
  const window: any = {
    __renplay: { id: game, userId, saveDir: game === 'game' ? 'Game' : game, build: 'b1' },
    parent,
    location: { origin, href: `${origin}/g/${game}/b1/`, reload: vi.fn() },
    localStorage: storage(),
    sessionStorage: storage(),
    document,
    Document,
    HTMLMediaElement,
    navigator: {},
    fetch,
    setTimeout: later,
    clearTimeout: cancel,
    setInterval: (fn: () => void) => intervals.push(fn),
    clearInterval: vi.fn(),
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 16),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    MessageChannel,
    structuredClone,
    DOMException,
    Headers,
    Response,
    URL,
    URLSearchParams,
    Blob,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    addEventListener: (type: string, listener: Listener) => (listeners[type] ??= []).push(listener),
    focus: vi.fn(),
  }
  window.window = window
  if (!framed) window.parent = window
  const fire = (type: string, event: Record<string, unknown> = {}) => {
    for (const listener of listeners[type] ?? []) listener(event)
    for (const listener of listeners[`document:${type}`] ?? []) listener(event)
  }
  const message = (data: Record<string, unknown>) => fire('message', { source: parent, origin, data })
  const runDelayed = (delay: number) => {
    let ran = false
    for (const [id, timer] of [...delayed]) {
      if (timer.delay !== delay) continue
      delayed.delete(id)
      timer.fn(...timer.args)
      ran = true
    }
    return ran
  }
  return { window, post, fire, message, runDelayed, intervals }
}

/** The HTML games' runtime for a person, with its messages to the player and helpers to flush and answer. */
export function htmlRuntime(userId = 1, setup?: (window: any) => void) {
  const page = browser(userId, 'game', vi.fn(async () => new Response('{}')), true)
  setup?.(page.window)
  runInNewContext(runtimes.html, page.window)
  let flushId = 0
  const flush = async () => {
    const id = ++flushId
    page.message({ type: 'renplay:flush', id })
    await vi.waitFor(() => {
      expect(page.post.mock.calls.some(([message]) => message.type === 'renplay:flushed' && message.id === id)).toBe(true)
    })
  }
  const storagePosts = () => page.post.mock.calls.map(([message]) => message).filter((message) => message.type === 'renplay:storage')
  const kept = (data: string, kind = 'idb') => page.message({ type: 'renplay:storage-kept', userId, kind, data })
  return { ...page, flush, storagePosts, kept }
}

/** One IndexedDB for several runtimes, like a browser shared by several people. */
export function sharedMirror() {
  const seed = htmlRuntime(0)
  return new seed.window.__renplayIDB.IDBFactory()
}

/** What Ren'Py's runtime keeps of unsent saves on this device, for every person. */
export async function mirrorEntries(indexedDB: any): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('renplay', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'key' })
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('files', 'readonly')
      const all = tx.objectStore('files').getAll()
      tx.oncomplete = () => { db.close(); resolve(all.result) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  })
}

/** Puts an entry in that local copy, as an older version or another person would have left it. */
export async function putMirrorEntry(indexedDB: any, entry: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('renplay', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'key' })
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('files', 'readwrite')
      tx.objectStore('files').put(entry)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  })
}

/** Enough of Emscripten's file system for the runtime to restore and scan saves. */
function memoryFs() {
  const directories = new Set(['/'])
  const files = new Map<string, any>()
  const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
  const ensure = (path: string) => {
    if (directories.has(path)) return
    ensure(parent(path))
    directories.add(path)
  }
  const api: any = {
    mount: () => null,
    syncfs: (_populate: boolean, callback: () => void) => callback(),
    mkdir: (path: string) => {
      if (directories.has(path) || files.has(path)) throw new Error('File exists')
      ensure(parent(path))
      directories.add(path)
    },
    writeFile: (path: string, data: Uint8Array) => {
      ensure(parent(path))
      const contents = new Uint8Array(data)
      files.set(path, { contents, usedBytes: contents.length, mtime: new Date() })
    },
    readFile: (path: string) => {
      const file = files.get(path)
      if (!file) throw new Error('No such file')
      return file.contents
    },
    lookupPath: (path: string) => {
      if (files.has(path)) return { node: files.get(path) }
      if (directories.has(path)) return { node: { directory: true } }
      throw new Error('No such file')
    },
    utime: (path: string, mtime: number) => {
      const file = files.get(path)
      if (file) file.mtime = new Date(mtime)
    },
    stat: (path: string) => {
      if (directories.has(path)) return { mode: 16877, size: 0, mtime: new Date(0) }
      const file = files.get(path)
      if (!file) throw new Error('No such file')
      return { mode: 33206, size: file.usedBytes, mtime: file.mtime }
    },
    readdir: (path: string) => {
      if (!directories.has(path)) throw new Error('No such directory')
      const prefix = path === '/' ? '/' : `${path}/`
      const names = new Set<string>()
      for (const child of [...directories, ...files.keys()]) {
        if (child === path || !child.startsWith(prefix)) continue
        const rest = child.slice(prefix.length)
        if (rest && !rest.includes('/')) names.add(rest)
      }
      return ['.', '..', ...names]
    },
    unlink: (path: string) => {
      if (!files.delete(path)) throw new Error('No such file')
    },
    isDir: (mode: number) => (mode & 61440) === 16384,
    isFile: (mode: number) => (mode & 61440) === 32768,
  }
  return {
    api,
    write: (path: string, data: Uint8Array, mtime: number) => {
      api.writeFile(path, data)
      api.utime(path, mtime, mtime)
    },
    read: (path: string) => {
      try { return Array.from(api.readFile(path) as Uint8Array) } catch { return null }
    },
  }
}

/** Ren'Py's runtime for a person, started through Emscripten's preRun with a memory file system and the given fetch. */
export function renpyRuntime({ userId, game = 'game', indexedDB, fetch, framed = true }: {
  userId: number
  game?: string
  indexedDB: any
  fetch: Fetch
  framed?: boolean
}) {
  const page = browser(userId, game, fetch, framed)
  const fs = memoryFs()
  const dependencies = new Set<string>()
  page.window.FS = fs.api
  page.window.indexedDB = indexedDB
  page.window.Module = {
    preRun: [],
    addRunDependency: (name: string) => dependencies.add(name),
    removeRunDependency: (name: string) => dependencies.delete(name),
  }
  runInNewContext(runtimes.renpy, page.window)
  const runtime = page.window.__renplayRuntime
  const home = '/home/web_user/.renpy'
  const write = (path: string, data: Uint8Array, mtime: number) => {
    runtime.state.ready = true
    fs.write(`${home}/${path}`, data, mtime)
    runtime.scan()
  }
  const idle = async () => {
    await vi.waitFor(() => expect(runtime.state.inflight).toBe(false))
  }
  const boot = async () => {
    page.window.__renplayLate()
    for (const preRun of [...page.window.Module.preRun].reverse()) preRun()
    await vi.waitFor(() => expect(dependencies.has('renplay-saves')).toBe(false), { timeout: 5000 })
  }
  return {
    ...page,
    runtime,
    write,
    idle,
    boot,
    read: (path: string) => fs.read(`${home}/${path}`),
    entries: () => mirrorEntries(indexedDB),
  }
}
