import { useCallback, useEffect, useRef, useState } from 'react'
import { replayHtmlSaves } from '../../lib/html-save-queue'
import { htmlSaveKeeper, type HtmlSaveContext, type HtmlSaveKeeper } from './htmlSaves'

type Send = (msg: Record<string, unknown>) => void
const newId = () => Math.random().toString(36).slice(2)

/**
 * Saving through the game: Save now (a quick save, synced to the server) and saving before
 * leaving, each answered by the game with the id it was asked with.
 */
export function useSaving(send: Send, ready: boolean, toast: (text: string, tone?: 'success' | 'error' | 'info') => void) {
  const [savingNow, setSavingNow] = useState(false)
  // What Save now just did, said on its row for three seconds.
  const [savedAs, setSavedAs] = useState<string | null>(null)
  const savedTimer = useRef(0)
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
  const savedNow = (id: string, saved: boolean) => {
    if (id !== savingId.current) return
    savingId.current = null
    setSavingNow(false)
    // Where it went is the whole explanation. A save that waits for the server says so in the menu's footer.
    setSavedAs(saved ? 'Saved as Quick 1' : 'Nothing to save yet')
    window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSavedAs(null), 3000)
  }

  return { savingNow, savedAs, saveNow, savedNow, saveAndFlush, flushed }
}

/**
 * A sandboxed HTML game's storage. Snapshots left unsent on this device go up before the game
 * starts (`ready`). New ones go through htmlSaveKeeper.
 */
export function useHtmlSaves(sandboxed: boolean, userId: number, gameId: string, attempt: number, send: Send, onSignedOut: () => void, onFailed: (message: string) => void) {
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

  const context = useRef<HtmlSaveContext>({ userId, gameId, send, onSignedOut })
  context.current = { userId, gameId, send, onSignedOut }
  const keeper = useRef<HtmlSaveKeeper | null>(null)
  keeper.current ??= htmlSaveKeeper(() => context.current)
  return { ready, store: keeper.current.store, kept: keeper.current.kept }
}
