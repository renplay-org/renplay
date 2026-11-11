import { Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { isApple, isTouchDevice } from '../lib/platform'
import { reducedMotion } from './travel'
import './Search.css'

/** The field on screen, which Ctrl K, ⌘K or / goes to. */
let field: HTMLInputElement | null = null
/** A shortcut was pressed on a page with no search: the next one takes the focus. */
let wanted = false
/** Where the toolbar's anchor was on the screen just before a change that moves the page above it. */
let held: { top: number; at: number } | null = null
/** How long after a change the page may still be waiting to show it. */
const HELD_MS = 500

const toolbarOf = () => document.querySelector<HTMLElement>('.toolbar[role="search"]')
const anchorOf = () => document.querySelector<HTMLElement>('.toolbar-top')
/** How far from the top of the screen the toolbar sticks. */
const stickAt = (toolbar: HTMLElement) => Number.parseFloat(getComputedStyle(toolbar).top) || 0

/** Scrolls at once: every scroll of the search is made by `parkResults`, frame by frame, or is a correction. */
function scrollNow(top: number) {
  window.scrollTo({ top, behavior: 'instant' })
}

/**
 * Where the page scrolls to so the toolbar is stuck under the header with the first row of results just under
 * it. Read from the page every time: what is above the toolbar may change while the page is on its way.
 */
function parkedAt(): number | null {
  const toolbar = toolbarOf()
  const anchor = anchorOf()
  if (!toolbar || !anchor) return null
  const rests = anchor.getBoundingClientRect().top + window.scrollY + Number.parseFloat(getComputedStyle(toolbar).marginTop)
  // Rounded up: a toolbar that is a fraction of a pixel short of the header has not stuck, and would sit there.
  return Math.max(0, Math.ceil(rests - stickAt(toolbar)))
}

/** Whether the toolbar is stuck under the header, or has been carried above it by a page scrolled further. */
function isParked(): boolean {
  const toolbar = toolbarOf()
  return !!toolbar && toolbar.getBoundingClientRect().top <= stickAt(toolbar) + 0.5
}

/** Whether the page has a search worth scrolling to: set by `useSearchScroll`. Clearing it ends a scroll on its way. */
let engagedNow = false
/** The scroll on its way (the id of its next frame), if any. */
let parking = 0
/** The time constant of the scroll: it covers 1 - 1/e of what is left every 90 ms, so it slows as it arrives. */
const TAU_MS = 90
/** A slow frame still moves the page by what a quick one would: it counts for at most this long. */
const FRAME_MAX_MS = 24

/** A person's own scroll or tap ends the page's, as does any key that is not typing in a field. */
const stopsParking = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
function ownInput(e: Event) {
  if (e.type === 'keydown' && (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
  cancelParking()
}
function cancelParking() {
  if (parking) cancelAnimationFrame(parking)
  parking = 0
  for (const type of stopsParking) window.removeEventListener(type, ownInput)
}

/**
 * Scrolls the page, smoothly, so the toolbar is stuck under the header with the results below it: called for a key
 * in the search, a tag or a filter, and for the shortcuts. It does nothing if the page is there. It runs frame by
 * frame (the browser's own smooth scroll stops at the first scroll made on top of it) and reads where to go
 * on every frame, so another key on the way takes it to the same place without a stutter, and a change of what
 * is above the toolbar (the Library's shelves) is followed. With reduced motion it is one jump.
 */
export function parkResults(): void {
  if (reducedMotion()) {
    const to = parkedAt()
    if (to !== null && Math.abs(window.scrollY - to) > 1) scrollNow(to)
    return
  }
  if (parking) return
  const started = engagedNow
  let last = performance.now()
  let stalled = 0
  const frame = (now: number) => {
    parking = 0
    // The search was cleared on the way: there is nothing to scroll to.
    const to = parkedAt()
    if (to === null || (started && !engagedNow)) return cancelParking()
    const left = to - window.scrollY
    if (Math.abs(left) <= 1) {
      if (left) scrollNow(to)
      return cancelParking()
    }
    // The frame's own time can be a little before the time the scroll was started at: never a negative step.
    const dt = Math.max(1, Math.min(now - last, FRAME_MAX_MS))
    last = now
    let step = left * (1 - Math.exp(-dt / TAU_MS))
    // At least a pixel, so it arrives.
    if (Math.abs(step) < 1) step = Math.sign(left)
    const before = window.scrollY
    scrollNow(before + step)
    // The toolbar's place on the screen that a change of the page above it is to keep moves with the page.
    if (held) held.top -= window.scrollY - before
    stalled = window.scrollY === before ? stalled + 1 : 0
    if (stalled > 3) return cancelParking()
    parking = requestAnimationFrame(frame)
  }
  for (const type of stopsParking) window.addEventListener(type, ownInput, { passive: true })
  parking = requestAnimationFrame(frame)
}

/** Where the page's visible part ends: the top of the tab bar on a phone, which covers the bottom of the page. */
function floorOfScreen(): number {
  const bar = document.querySelector<HTMLElement>('.tabbar')
  return bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : window.innerHeight
}

/**
 * While a search is typed the tiles move under a pointer that rests on the list, and each one that lands under it
 * would lift and settle again. The page says so (`data-typing`) until the pointer really moves: it moves when its
 * place on the screen changes, which the browser's own repeat of the last position after a scroll does not.
 */
function useTypingCalm(): () => void {
  useEffect(() => {
    const root = document.documentElement
    let at = ''
    const moved = (e: PointerEvent) => {
      const now = `${e.clientX},${e.clientY}`
      if (now !== at) root.removeAttribute('data-typing')
      at = now
    }
    window.addEventListener('pointermove', moved, { passive: true })
    return () => {
      window.removeEventListener('pointermove', moved)
      root.removeAttribute('data-typing')
    }
  }, [])
  return () => document.documentElement.setAttribute('data-typing', '')
}

/** Moves the focus to the page's search, without the browser scrolling to it, and takes the page to it smoothly. False when this page has none. */
export function focusSearch(): boolean {
  if (!field) return false
  field.focus({ preventScroll: true })
  field.select()
  const toolbar = toolbarOf()
  if (toolbar) {
    const box = toolbar.getBoundingClientRect()
    if (box.top < stickAt(toolbar) - 1 || box.bottom > floorOfScreen()) parkResults()
  }
  return true
}

export function wantSearch(): void {
  wanted = true
}

/**
 * Call just before a change that adds or removes what is above the toolbar (the Library's shelves go while
 * a search is on). The page keeps the toolbar where it is on the screen: see `useSearchScroll`.
 */
export function holdPlace(): void {
  const anchor = anchorOf()
  held = anchor ? { top: anchor.getBoundingClientRect().top, at: performance.now() } : null
}

/**
 * The page's side of the search's scrolling. `engaged` is whether a search, a tag or a filter is on. Anything
 * that is above the toolbar and goes while it is on (the Library's shelves) stays until the page has scrolled it
 * out of view, which is what is returned: whether it is gone (`away`). Its going, and its coming back, leave the
 * toolbar where it is on the screen: the page's scroll follows before anything is painted, and nothing is seen to
 * move. Clearing the search ends a scroll on its way.
 */
export function useSearchScroll(engaged: boolean): boolean {
  // A page opened on a search (an address, the back button) has its shelves gone from the start.
  const [away, setAway] = useState(engaged)
  const gone = away && engaged
  useLayoutEffect(() => {
    engagedNow = engaged
    return () => {
      engagedNow = false
    }
  }, [engaged])
  // The page's own correction below is the only one: a browser that also anchors the scroll would add its own.
  useEffect(() => {
    document.documentElement.style.overflowAnchor = 'none'
    return () => {
      document.documentElement.style.overflowAnchor = ''
      cancelParking()
    }
  }, [])
  useEffect(() => {
    if (!engaged) {
      setAway(false)
      return
    }
    if (away) return
    // The shelves go once the toolbar is under the header, as the page scrolls to it or because it already was.
    const check = () => {
      if (!isParked()) return
      holdPlace()
      setAway(true)
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    return () => window.removeEventListener('scroll', check)
  }, [engaged, away])
  useLayoutEffect(() => {
    const anchor = anchorOf()
    if (!held || !anchor || performance.now() - held.at > HELD_MS) return
    const toolbar = toolbarOf()
    const by = anchor.getBoundingClientRect().top - held.top
    // A toolbar that was stuck stays stuck, to the pixel: the scroll is rounded to the side that keeps it so.
    const stuck = !!toolbar && held.top + Number.parseFloat(getComputedStyle(toolbar).marginTop) <= stickAt(toolbar)
    held = null
    if (Math.abs(by) > 0.5) window.scrollBy({ top: stuck ? Math.ceil(by) : Math.round(by), behavior: 'instant' })
  }, [gone])
  return gone
}

/**
 * The search and the controls beside it, stuck under the header while the results scroll beneath. It is a
 * search landmark; the results below it are not part of it. The anchor in front marks where it rests. While it
 * is stuck the rows above it are hidden (they keep their space) and a see-through bar like the header's, with
 * its blur, runs from the top of the screen down to the toolbar's bottom: nothing of the page reads through
 * the header or between the controls, and tiles go soft as they pass under it.
 */
export function Toolbar({ label, wrap, style, children }: { label: string; wrap?: boolean; style?: CSSProperties; children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null)
  const glass = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const toolbar = bar.current
    const cover = glass.current
    const page = toolbar?.parentElement
    if (!toolbar || !cover || !page) return
    const settle = () => {
      const top = toolbar.getBoundingClientRect().top
      const at = stickAt(toolbar)
      cover.style.setProperty('--stuck-h', `${at + toolbar.offsetHeight}px`)
      // Stuck is exactly at its place under the header: a toolbar above it was carried off by the end of its section.
      const stuck = Math.abs(top - at) <= 0.5
      cover.toggleAttribute('data-stuck', stuck)
      page.toggleAttribute('data-stuck', stuck)
    }
    settle()
    const watcher = new ResizeObserver(settle)
    watcher.observe(toolbar)
    watcher.observe(document.body)
    window.addEventListener('scroll', settle, { passive: true })
    return () => {
      watcher.disconnect()
      window.removeEventListener('scroll', settle)
      page.removeAttribute('data-stuck')
    }
  }, [])
  return (
    <>
      <div className="toolbar-top" aria-hidden="true" />
      <div className="toolbar-glass" aria-hidden="true" ref={glass} />
      <div role="search" aria-label={label} className={`toolbar ${wrap ? 'wrap' : ''}`.trim()} style={style} ref={bar}>
        {children}
      </div>
    </>
  )
}

/** How many games are shown: "84", and "12 of 84" while a search, a tag or a filter narrows the list. */
export const countText = (shown: number, total: number, narrowed: boolean) => (narrowed ? `${shown} of ${total}` : String(total))

/** A title with the letters a search matched marked, from and to pairs in the title as written. */
export function Marked({ text, marks }: { text: string; marks?: number[] }) {
  if (!marks?.length) return text
  const parts: ReactNode[] = []
  let at = 0
  for (let i = 0; i < marks.length; i += 2) {
    const from = Math.max(at, marks[i]!)
    const to = Math.min(text.length, marks[i + 1]!)
    if (to <= from) continue
    if (from > at) parts.push(text.slice(at, from))
    parts.push(<mark key={from}>{text.slice(from, to)}</mark>)
    at = to
  }
  parts.push(text.slice(at))
  return <>{parts}</>
}

/**
 * The search: one field above a list, filtering it as you type. A pill like the controls beside it, with
 * its shortcut shown on a desktop (a phone has no keyboard shortcuts) and a clear button while it holds text.
 * `label` names the field and is its hint. While the toolbar is stuck the heading with the count is out of
 * sight, so the field says the count at its right end while it holds text. A screen reader hears the count
 * once the person pauses, not on every key.
 */
export default function SearchField({ value, onChange, label, count }: { value: string; onChange: (text: string) => void; label: string; count: { shown: number; total: number; narrowed: boolean } }) {
  const input = useRef<HTMLInputElement>(null)
  const typing = useTypingCalm()
  const text = countText(count.shown, count.total, count.narrowed)
  const [heard, setHeard] = useState(text)
  useEffect(() => {
    const timer = window.setTimeout(() => setHeard(text), 600)
    return () => window.clearTimeout(timer)
  }, [text])
  useEffect(() => {
    field = input.current
    if (wanted) {
      wanted = false
      focusSearch()
    }
    return () => {
      if (field === input.current) field = null
    }
  }, [])
  const change = (text: string) => {
    holdPlace()
    typing()
    onChange(text)
    parkResults()
  }
  return (
    <div className="search-field">
      <Search aria-hidden="true" />
      <input
        ref={input}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={label}
        aria-keyshortcuts={isApple() ? 'Meta+K /' : 'Control+K /'}
        placeholder={label}
        value={value}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isTouchDevice()) input.current?.blur()
          if (e.key !== 'Escape') return
          if (value) change('')
          else input.current?.blur()
        }}
      />
      {value && (
        <span className="field-count tnum" aria-hidden="true" style={{ minWidth: `${String(count.total).length * 2 + 4}ch` }}>
          {text}
        </span>
      )}
      <p role="status" className="sr-only">
        {heard} {count.total === 1 ? 'game' : 'games'}
      </p>
      {value ? (
        <button type="button" className="clear" aria-label="Clear the search" onClick={() => { change(''); input.current?.focus({ preventScroll: true }) }}>
          <X aria-hidden="true" />
        </button>
      ) : (
        <kbd className="shortcut" aria-hidden="true">{isApple() ? '⌘K' : 'Ctrl K'}</kbd>
      )}
    </div>
  )
}
