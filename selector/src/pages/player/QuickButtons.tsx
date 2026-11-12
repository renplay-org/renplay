// A prototype (layout 3): pills over the game that hide themselves like a video player's controls.
import { BookOpen, CloudOff, Expand, Save } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { PadMenuGlyph } from '../../lantern/Keycap'
import { cx } from '../../lantern/ui'

const HIDE_AFTER = 3000
/** How far from the buttons a moving pointer brings them back, and how deep at the top a tap does. */
const NEAR = 80
const TAP_TOP = 96

/**
 * When the buttons show. They hide after three seconds without input and come back on a pointer near them,
 * a tap at the top of the screen, a controller, or focus inside them. `keep` holds them on screen.
 * `wake` takes page coordinates, so what the game frame reports is added to the frame's own place first.
 */
export function useQuickButtons(layout3: boolean, ready: boolean, menuOpen: boolean, keep: boolean, boxRef: RefObject<HTMLElement | null>, send: (msg: Record<string, unknown>) => void) {
  const on = layout3 && ready && !menuOpen
  const [shown, setShown] = useState(true)
  const timer = useRef(0)
  const held = useRef(false)
  const rest = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (!held.current && !boxRef.current?.contains(document.activeElement)) setShown(false)
    }, HIDE_AFTER)
  }, [boxRef])
  const show = useCallback(() => {
    setShown(true)
    rest()
  }, [rest])
  const wake = useCallback(
    (x: number, y: number, down: boolean) => {
      const box = boxRef.current?.getBoundingClientRect()
      const near = !!box && x >= box.left - NEAR && x <= box.right + NEAR && y >= box.top - NEAR && y <= box.bottom + NEAR
      if (near || (down && y < TAP_TOP)) show()
    },
    [boxRef, show],
  )
  useEffect(() => {
    if (!on) return
    show()
    const move = (e: PointerEvent) => wake(e.clientX, e.clientY, e.type === 'pointerdown')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', move)
    // A controller in the player: any button or stick is input.
    const pad = window.setInterval(() => {
      const pressed = [...(navigator.getGamepads?.() ?? [])].some((p) => p && (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5)))
      if (pressed) show()
    }, 150)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', move)
      window.clearInterval(pad)
      window.clearTimeout(timer.current)
    }
  }, [on, show, wake])
  // The game's frame reports the pointer only while the buttons need it. They come back when the menu closes.
  useEffect(() => {
    if (ready) send({ type: 'renplay:watch', on: layout3 })
  }, [ready, layout3, send])
  useEffect(() => {
    if (!menuOpen) show()
  }, [menuOpen, show])
  return {
    visible: !on || keep || shown,
    wake,
    show,
    hold: (h: boolean) => {
      held.current = h
      if (h) show()
      else rest()
    },
  }
}

/** Menu, Save now, Guide (when there is one) and Full screen, as pills at the top left, or the top right for HTML games. */
export default function QuickButtons({
  boxRef,
  style,
  visible,
  hold,
  pad,
  onMenu,
  onSave,
  saved,
  onGuide,
  guideHref,
  onFullscreen,
  waiting,
}: {
  boxRef: RefObject<HTMLDivElement | null>
  style: CSSProperties
  visible: boolean
  hold: (held: boolean) => void
  pad: boolean
  onMenu: () => void
  /** Ren'Py games only. */
  onSave?: () => void
  saved: string | null
  onGuide?: () => void
  guideHref?: string
  onFullscreen?: () => void
  waiting: boolean
}) {
  return (
    <div ref={boxRef} className={cx('rp-pills qb', !visible && 'away')} style={style} onPointerEnter={() => hold(true)} onPointerLeave={() => hold(false)} onFocus={() => hold(true)} onBlur={() => hold(false)}>
      <button type="button" className="rp-pill" onClick={onMenu} aria-label="Menu">
        <span className="mark" aria-hidden="true" />
        Menu
        {pad && <PadMenuGlyph />}
      </button>
      {onSave && (
        <button type="button" className="rp-pill" onClick={onSave} aria-label="Save now">
          <Save aria-hidden="true" />
          <span className="lbl">{saved ? 'Saved' : 'Save now'}</span>
        </button>
      )}
      {onGuide ? (
        <button type="button" className="rp-pill" onClick={onGuide} aria-label="Guide">
          <BookOpen aria-hidden="true" />
          <span className="lbl">Guide</span>
        </button>
      ) : (
        guideHref && (
          <a className="rp-pill" href={guideHref} target="_blank" rel="noreferrer" aria-label="Guide">
            <BookOpen aria-hidden="true" />
            <span className="lbl">Guide</span>
          </a>
        )
      )}
      {onFullscreen && (
        <button type="button" className="rp-pill icon" onClick={onFullscreen} aria-label="Full screen">
          <Expand aria-hidden="true" />
        </button>
      )}
      {waiting && (
        <span className="rp-cloud" role="status" aria-label="Some saves have not reached the server yet">
          <CloudOff aria-hidden="true" />
        </span>
      )}
    </div>
  )
}
