import { useCallback, useEffect, useState, type RefObject } from 'react'
import { fullscreenCoversNotch, type fullscreenMode } from '../../lib/display'
import { keyboard } from './keyboard'

/**
 * Fullscreen for the player: the Fullscreen API with landscape held on phones and Esc locked on
 * computers (a tap reaches the game, holding it leaves), or the Home Screen's help on iPhone
 * (`onHomeScreen`). The game hears when fullscreen starts and ends.
 */
export function useFullscreen(shellRef: RefObject<HTMLElement | null>, fsMode: ReturnType<typeof fullscreenMode>, touch: boolean, send: (msg: Record<string, unknown>) => void, onHomeScreen: () => void) {
  const [fullscreen, setFullscreen] = useState(false)
  const [coversNotch, setCoversNotch] = useState(false)
  // Esc is locked (a tap reaches the game), shown as a hint for a few seconds, and currently held down.
  const [escLocked, setEscLocked] = useState(false)
  const [escHint, setEscHint] = useState(false)
  const [escHeld, setEscHeld] = useState(false)
  const toggleFullscreen = useCallback(
    async (want?: boolean) => {
      if (fsMode === 'home-screen') {
        if (want !== false) onHomeScreen()
        return
      }
      if (fsMode !== 'api') return
      const on = !!document.fullscreenElement
      const target = want ?? !on
      try {
        if (target && !on) {
          await shellRef.current?.requestFullscreen({ navigationUI: 'hide' })
          // Phones: games are wide, so hold landscape while in fullscreen.
          if (touch) await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {})
          // Chrome may refuse the lock (it asks for permission since 130): then Esc just leaves.
          else if (keyboard()?.lock) setEscLocked(await keyboard()!.lock!(['Escape']).then(() => true, () => false))
        } else if (!target && on) await document.exitFullscreen()
      } catch {}
    },
    [fsMode, touch],
  )
  useEffect(() => {
    const onChange = () => {
      const on = !!document.fullscreenElement
      if (!on) {
        keyboard()?.unlock?.()
        setEscLocked(false)
        setEscHeld(false)
      }
      setFullscreen(on)
      send({ type: 'renplay:fullscreen-state', value: on })
      setTimeout(() => setCoversNotch(on && fullscreenCoversNotch()), 250)
      send({ type: 'renplay:focus' })
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [send])

  // Esc in fullscreen: say how to leave when it starts, and show the hold.
  useEffect(() => {
    if (!escLocked) return
    setEscHint(true)
    const t = setTimeout(() => setEscHint(false), 4000)
    return () => clearTimeout(t)
  }, [escLocked])
  useEffect(() => {
    if (!escLocked) return
    // When the player rather than the game has focus.
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.repeat) setEscHeld(down)
    }
    const down = key(true)
    const up = key(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [escLocked])
  return { fullscreen, coversNotch, escLocked, escHint, escHeld, setEscHeld, toggleFullscreen }
}
