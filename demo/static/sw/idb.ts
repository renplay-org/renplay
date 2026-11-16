import type { Store, Table } from './types'

const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('renplay-demo', 1)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore('files', { keyPath: 'key' })
      db.createObjectStore('versions', { keyPath: 'id' }).createIndex('key', 'key')
      db.createObjectStore('notes', { keyPath: 'key' })
      db.createObjectStore('progress', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

/** The visitor's saves and progress, in this browser's IndexedDB. */
export function idbStore(): Store {
  let opened: Promise<IDBDatabase> | null = null
  async function tx<T>(table: Table, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await (opened ??= open())
    return new Promise((resolve, reject) => {
      const t = db.transaction(table, mode)
      const req = run(t.objectStore(table))
      t.oncomplete = () => resolve(req.result)
      t.onerror = t.onabort = () => reject(t.error)
    })
  }
  return {
    all: (table) => tx(table, 'readonly', (s) => s.getAll()) as never,
    get: (table, key) => tx(table, 'readonly', (s) => s.get(key)) as never,
    put: async (table, row) => void (await tx(table, 'readwrite', (s) => s.put(row))),
    del: async (table, key) => void (await tx(table, 'readwrite', (s) => s.delete(key))),
  }
}
