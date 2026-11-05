import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { queueHtmlSave, uploadHtmlSave } from '../../../selector/src/lib/html-save-queue.js'

it('Player persists and acknowledges both HTML storage snapshots while the first upload is pending', async () => {
  const window: any = {}
  const vendor = readFileSync(new URL('../../../runtime/vendor/fake-indexeddb.js', import.meta.url), 'utf-8')
  runInNewContext(vendor, { window, structuredClone, setTimeout, clearTimeout, console, DOMException })
  const indexedDB = new window.__renplayIDB.IDBFactory()
  vi.stubGlobal('indexedDB', indexedDB)
  let release!: () => void
  const firstUpload = new Promise<void>((resolve) => { release = resolve })
  const uploaded: string[] = []
  const fetch = vi.fn(async (_url, init) => {
    if (!uploaded.length) await firstUpload
    uploaded.push(init.body)
    return new Response('{}')
  })
  vi.stubGlobal('fetch', fetch)
  const send = vi.fn(), setSignedOut = vi.fn()
  const storageWrite = { current: Promise.resolve() }, storageUpload = { current: Promise.resolve() }
  // Execute the actual Player message handler, including its separate durable/upload queues.
  const source = readFileSync(new URL('../../../selector/src/pages/Player.tsx', import.meta.url), 'utf-8')
  const storage = source.slice(source.indexOf("        case 'renplay:storage':"), source.indexOf("        case 'renplay:exited':"))
  const receive = new Function('storageWrite', 'storageUpload', 'queueHtmlSave', 'uploadHtmlSave', 'send', 'setSignedOut', `
    var sandboxed = true, game = { saveDir: 'Html' }, gameId = 'html', userId = 1;
    return function (d) { switch ('renplay:storage') { ${storage} } };
  `)(storageWrite, storageUpload, queueHtmlSave, uploadHtmlSave, send, setSignedOut)
  const pending = () => new Promise<any[]>((resolve, reject) => {
    const open = indexedDB.open('renplay-html-queue', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('files', 'readonly'), all = tx.objectStore('files').getAll()
      tx.oncomplete = () => { db.close(); resolve(all.result) }
      tx.onerror = () => reject(tx.error)
    }
  })
  try {
    receive({ data: '{"progress":"first"}' })
    await storageWrite.current
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    for (const kind of [undefined, 'idb']) receive({ kind, data: '{"progress":"second"}' })
    await storageWrite.current
    expect(send).toHaveBeenCalledTimes(3)
    expect(send).toHaveBeenLastCalledWith({ type: 'renplay:storage-kept', kind: 'idb', data: '{"progress":"second"}', userId: 1 })
    expect(await pending()).toMatchObject([
      { path: 'Html/indexedDB.json', data: '{"progress":"second"}' },
      { path: 'Html/localStorage.json', data: '{"progress":"second"}' },
    ])
    expect(uploaded).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
    release()
    await storageUpload.current
    expect(uploaded).toEqual(['{"progress":"first"}', '{"progress":"second"}', '{"progress":"second"}'])
    expect(await pending()).toEqual([])
    expect(setSignedOut).not.toHaveBeenCalled()
  } finally {
    release()
    await storageUpload.current
    vi.unstubAllGlobals()
  }
})
