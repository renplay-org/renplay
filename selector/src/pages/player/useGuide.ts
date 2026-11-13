import { useCallback, useRef, useState, type RefObject } from 'react'
import type { Game } from '@shared/api'
import type { GuideMode } from '../../components/GuideWindow'
import { keptFile } from '../../components/guide/keep'

/**
 * The guide's state beside the game: which file is open, whether it has asked for focus, and whether it holds
 * the keyboard and the controller now. A window opens beside the menu, which stays. A sheet or the whole screen
 * on a phone takes the menu's place, which closes. Closing it gives the game focus again unless the menu is
 * still open, which keeps it.
 */
export function useGuide({ game, mode, menuOpen, leaveMenu, sheetRef, send }: { game: Game | undefined; mode: GuideMode; menuOpen: () => boolean; leaveMenu: () => void; sheetRef: RefObject<HTMLDivElement | null>; send: (msg: Record<string, unknown>) => void }) {
  const [file, setFile] = useState<string | null>(null)
  // The right edge of the menu's sheet when the window opens beside it, so it starts to the right of it.
  const [after, setAfter] = useState<number | undefined>()
  // Counts the times the guide was asked for by the keyboard, the controller or the menu: focus goes into it.
  const [focusToken, setFocusToken] = useState(0)
  // Focus is in the guide: it holds the controller, and the game does not.
  const [active, setActive] = useState(false)
  // Opened once in this visit: a phone then keeps a Guide pill beside Menu to switch between reading and playing.
  const [seen, setSeen] = useState(false)
  const fileRef = useRef(file)
  fileRef.current = file

  const open = useCallback(() => {
    if (!game?.walkthroughs.length) return
    if (!fileRef.current) {
      setFile(keptFile(game))
      setSeen(true)
      const sheet = sheetRef.current
      if (menuOpen() && mode === 'window' && sheet) setAfter(sheet.offsetLeft + sheet.offsetWidth)
    }
    if (menuOpen() && mode !== 'window') leaveMenu()
    setFocusToken((n) => n + 1)
  }, [game, mode, menuOpen, leaveMenu, sheetRef])
  const close = useCallback(() => {
    setFile(null)
    setAfter(undefined)
    setActive(false)
    if (!menuOpen()) send({ type: 'renplay:focus' })
  }, [menuOpen, send])
  const toggle = useCallback(() => (fileRef.current ? close() : open()), [open, close])
  // The guide stays over the game, and focus and the controller go back to what is under it: the menu, or the game.
  const park = useCallback(() => {
    const row = menuOpen() ? sheetRef.current?.querySelector<HTMLElement>('[data-guide]') : null
    if (row) row.focus()
    else send({ type: 'renplay:focus' })
  }, [menuOpen, sheetRef, send])
  return { file, setFile, after, focusToken, active, setActive, seen, open, close, toggle, park }
}
