import { useCallback, useEffect, useRef, useState } from 'react'
import { queueHtmlSave, replayHtmlSaves, uploadHtmlSave } from '../../lib/html-save-queue'

type Send = (msg: Record<string, unknown>) => void
const newId = () => Math.random().toString(36).slice(2)

/**
 * Saving through the game: Save now (a quick save, synced to the server) and saving before
 * leaving, each answered by the game with the id it was asked with.
 */
export function useSaving(send: Send, ready: boolean, toast: (text: string, tone?: 'success' | 'error' | 'info') => void) {
  const [savingNow, setSavingNow] = useState(false)
  const savingId = useRef<string | null>(null)
  const waiters = useRef(new Map<string, (ok: boolean) => void>())

  /**
   * Saves (an autosave, or a quick save in a game without autosave), then waits until every save
   * reached the server. Longer than the runtime's own limits, so its answer always arrives first.
   */
  const saveAndFlush = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        const id = newId()
        const t = setTimeout(() => (waiters.current.delete(id), resolve(false)), 20_000)
        waiters.current.set(id, (ok) => {
          clearTimeout(t)
          waiters.current.delete(id)
          resolve(ok)
        })
        send({ type: ready ? 'renplay:save-and-exit' : 'renplay:flush', id })
      }),
    [ready, send],
  )
  /** The game's answer to saveAndFlush. */
  const flushed = (id: string, ok: boolean) => waiters.current.get(id)?.(ok)

  const saveNow = () => {
    if (savingNow) return
    const id = newId()
    savingId.current = id
    setSavingNow(true)
    send({ type: 'renplay:save-now', id })
    // A game that never answers does not leave the button saying Saving.
    window.setTimeout(() => {
      if (savingId.current !== id) return
      savingId.current = null
      setSavingNow(false)
      toast('The game did not answer. Try again, or save from its own menu.')
    }, 20_000)
  }
  /** The game's answer to saveNow. */
  const savedNow = (id: string, saved: boolean, ok: boolean) => {
    if (id !== savingId.current) return
    savingId.current = null
    setSavingNow(false)
    toast(saved ? (ok ? 'Saved' : 'Saved on this device. It syncs when the connection is back.') : 'Nothing to save in the main menu.', ok ? 'success' : 'info')
  }

  return { savingNow, saveNow, savedNow, saveAndFlush, flushed }
}

/**
 * A sandboxed HTML game's storage, which comes through the player. Snapshots left unsent on this
 * device go up before the game starts (`ready`). Each new one is kept on this device before the
 * game hears that it is, then uploaded.
 */
export function useHtmlSaves(sandboxed: boolean, userId: number, gameId: string, attempt: number, send: Send, onSignedOut: () => void, onFailed: (message: string) => void) {
  const write = useRef<Promise<unknown>>(Promise.resolve())
  const upload = useRef<Promise<unknown>>(Promise.resolve())
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!sandboxed) return
    let stopped = false
    setReady(false)
    void replayHtmlSaves(userId, gameId).then(() => {
      if (!stopped) setReady(true)
    }).catch(() => {
      if (!stopped) onFailed('Your unsent saves are kept on this device. Connect and retry to sync them before playing.')
    })
    return () => { stopped = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxed, userId, gameId, attempt])

  /** Keeps a snapshot of the game's whole storage (localStorage, or IndexedDB as 'idb'). */
  const store = (saveDir: string, kind: string | undefined, data: string) => {
    const path = `${saveDir}/${kind === 'idb' ? 'indexedDB.json' : 'localStorage.json'}`
    write.current = write.current
      .catch(() => {})
      .then(async () => {
        const entry = await queueHtmlSave(userId, gameId, path, data)
        send({ type: 'renplay:storage-kept', kind, data, userId })
        // A stalled upload must never delay the next durable snapshot or its acknowledgement.
        upload.current = upload.current.catch(() => {})
          .then(() => uploadHtmlSave(entry))
          .catch(onSignedOut)
      })
      .catch(onSignedOut)
  }
  /** Settles once every snapshot sent so far is kept on this device. */
  const kept = () => write.current

  return { ready, store, kept }
}
