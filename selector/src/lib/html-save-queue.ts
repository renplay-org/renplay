import { userHeader } from './api'
import { deviceHeaders } from './device'

interface PendingHtmlSave {
  key: string
  userId: number
  game: string
  path: string
  data: string
  mtime: number
}

let database: Promise<IDBDatabase> | undefined
function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('renplay-html-queue', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'key' })
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  return database.then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction('files', mode), request = action(tx.objectStore('files'))
    tx.oncomplete = () => resolve(request?.result as T)
    tx.onerror = tx.onabort = () => reject(tx.error)
  }))
}

/** Persist at the trusted parent origin, not the game's ephemeral opaque-origin storage. */
export async function queueHtmlSave(userId: number, game: string, path: string, data: string): Promise<PendingHtmlSave> {
  const entry = { key: `${userId}:${game}:${path}`, userId, game, path, data, mtime: Date.now() }
  await transaction('readwrite', (store) => store.put(entry))
  return entry
}

export async function uploadHtmlSave(entry: PendingHtmlSave): Promise<void> {
  const response = await fetch(`/api/saves/${entry.game}/file?path=${encodeURIComponent(entry.path)}`, {
    method: 'PUT', body: entry.data,
    headers: { ...deviceHeaders(), ...userHeader(entry.userId), 'content-type': 'application/octet-stream', 'x-mtime': String(entry.mtime) },
  })
  if (!response.ok) throw new Error(response.status === 401 ? 'You were signed out. Your saves are kept on this device.' : 'Your saves are kept on this device. Try syncing again.')
  await transaction('readwrite', (store) => {
    const current = store.get(entry.key)
    current.onsuccess = () => {
      if (current.result?.data === entry.data && current.result?.mtime === entry.mtime) store.delete(entry.key)
    }
  })
}

/** Replay only the returning owner's queue before loading a page with server-side storage. */
export async function replayHtmlSaves(userId: number, game: string): Promise<void> {
  const entries = await transaction<PendingHtmlSave[]>('readonly', (store) => store.getAll())
  for (const entry of entries) if (entry.userId === userId && entry.game === game) await uploadHtmlSave(entry)
}
