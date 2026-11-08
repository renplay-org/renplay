import { api, post } from './api'
import type { UploadStarted } from '@shared/api'

export interface UploadHandle {
  promise: Promise<string>
  pause(): void
  resume(): void
  cancel(): void
}

const STORE = 'renplay:uploads'

function remember(file: File, id: string) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}')
    all[`${file.name}:${file.size}:${file.lastModified}`] = id
    localStorage.setItem(STORE, JSON.stringify(all))
  } catch {}
}

function recall(file: File): string | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}')[`${file.name}:${file.size}:${file.lastModified}`] ?? null
  } catch {
    return null
  }
}

function forget(file: File) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '{}')
    delete all[`${file.name}:${file.size}:${file.lastModified}`]
    localStorage.setItem(STORE, JSON.stringify(all))
  } catch {}
}

/**
 * Uploads a (possibly huge) archive in chunks. Each chunk is its own request,
 * so proxies with request timeouts are fine, and an interrupted upload
 * resumes where it stopped (also after a page reload, for the same file).
 */
export function uploadArchive(file: File, onProgress: (sent: number, total: number) => void): UploadHandle {
  let paused = false
  let cancelled = false
  let wake: (() => void) | null = null
  let xhr: XMLHttpRequest | null = null

  const sendChunk = (id: string, offset: number, blob: Blob) =>
    new Promise<number>((resolve, reject) => {
      xhr = new XMLHttpRequest()
      xhr.open('PUT', `/api/uploads/${id}?offset=${offset}`)
      xhr.upload.onprogress = (e) => onProgress(offset + e.loaded, file.size)
      xhr.onload = () => {
        if (xhr!.status === 409) {
          try {
            resolve(JSON.parse(xhr!.responseText).received)
          } catch {
            reject(new Error('Upload offset mismatch'))
          }
        } else if (xhr!.status >= 200 && xhr!.status < 300) resolve(JSON.parse(xhr!.responseText).received)
        else reject(new Error(`Upload failed (${xhr!.status})`))
      }
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.onabort = () => reject(new Error('aborted'))
      xhr.send(blob)
    })

  const promise = (async () => {
    let id = recall(file)
    let chunk = 32 << 20
    let offset = 0
    if (id) {
      try {
        const s = await api<{ received: number; size: number }>(`/api/uploads/${id}`)
        if (s.size === file.size) offset = s.received
        else id = null
      } catch {
        id = null
      }
    }
    if (!id) {
      const r = await post<UploadStarted>('/api/uploads', { name: file.name, size: file.size })
      id = r.id
      chunk = r.chunkSize
      remember(file, id)
    }
    let failures = 0
    while (offset < file.size) {
      if (cancelled) throw new Error('Upload cancelled')
      if (paused) await new Promise<void>((r) => (wake = r))
      try {
        offset = await sendChunk(id, offset, file.slice(offset, Math.min(file.size, offset + chunk)))
        failures = 0
        onProgress(offset, file.size)
      } catch (e) {
        if (cancelled) throw new Error('Upload cancelled')
        if (paused) continue
        if (++failures > 8) throw e
        await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * 2 ** failures)))
        try {
          offset = (await api<{ received: number }>(`/api/uploads/${id}`)).received
        } catch {}
      }
    }
    const done = await post<{ path: string }>(`/api/uploads/${id}/complete`)
    forget(file)
    return done.path
  })()

  return {
    promise,
    pause() {
      paused = true
      xhr?.abort()
    },
    resume() {
      paused = false
      wake?.()
      wake = null
    },
    cancel() {
      cancelled = true
      paused = false
      xhr?.abort()
      wake?.()
      const id = recall(file)
      forget(file)
      if (id) void fetch(`/api/uploads/${id}`, { method: 'DELETE' })
    },
  }
}
