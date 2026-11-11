import { Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { isApple, isTouchDevice } from '../lib/platform'
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

/** Scrolls at once: the page's smooth scrolling is for scrolls a person asks for, and a search never is one. */
function scrollNow(top: number) {
  window.scrollTo({ top, behavior: 'instant' })
}

/** Puts the toolbar under the header, where it sticks, with the results in view below it. */
function bringToolbarUp() {
  const toolbar = toolbarOf()
  const anchor = anchorOf()
  if (!toolbar || !anchor) return
  const rests = anchor.getBoundingClientRect().top + window.scrollY + Number.parseFloat(getComputedStyle(toolbar).marginTop)
  // Rounded up: a toolbar that is a fraction of a pixel short of the header has not stuck, and would sit there.
  const to = Math.max(0, Math.ceil(rests - stickAt(toolbar)))
  if (Math.abs(window.scrollY - to) > 1) scrollNow(to)
}

/** Where the page's visible part ends: the top of the tab bar on a phone, which covers the bottom of the page. */
function floorOfScreen(): number {
  const bar = document.querySelector<HTMLElement>('.tabbar')
  return bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : window.innerHeight
}

/** Moves the focus to the page's search, without the browser scrolling to it. False when this page has none. */
export function focusSearch(): boolean {
  if (!field) return false
  field.focus({ preventScroll: true })
  field.select()
  const toolbar = toolbarOf()
  if (toolbar) {
    const box = toolbar.getBoundingClientRect()
    if (box.top < stickAt(toolbar) - 1 || box.bottom > floorOfScreen()) bringToolbarUp()
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
 * A new search (the first key after the field was empty) brings the toolbar under the header once, at once, so
 * the results are in view. Any other change above the toolbar leaves the toolbar where it was on the screen,
 * and the page's own scroll follows. `layout` is whatever decides what is above (the Library's shelves).
 */
export function useSearchScroll(searching: boolean, layout: unknown): void {
  const was = useRef(searching)
  // The page's own correction below is the only one: a browser that also anchors the scroll would add its own.
  useEffect(() => {
    document.documentElement.style.overflowAnchor = 'none'
    return () => {
      document.documentElement.style.overflowAnchor = ''
    }
  }, [])
  useLayoutEffect(() => {
    const starts = searching && !was.current
    was.current = searching
    if (starts) {
      held = null
      bringToolbarUp()
      return
    }
    const anchor = anchorOf()
    if (!held || !anchor || performance.now() - held.at > HELD_MS) return
    const toolbar = toolbarOf()
    const by = anchor.getBoundingClientRect().top - held.top
    // A toolbar that was stuck stays stuck, to the pixel: the scroll is rounded to the side that keeps it so.
    const stuck = !!toolbar && held.top + Number.parseFloat(getComputedStyle(toolbar).marginTop) <= stickAt(toolbar)
    held = null
    if (Math.abs(by) > 0.5) window.scrollBy({ top: stuck ? Math.ceil(by) : Math.round(by), behavior: 'instant' })
  }, [searching, layout])
}

/**
 * The search and the controls beside it, stuck under the header while the results scroll beneath. It is a
 * search landmark; the results below it are not part of it. The anchor in front marks where it rests. While it
 * is stuck a backdrop of the page's colour (the veil) covers the screen from the top down to its bottom, so
 * nothing of the page reads through the header or between the controls.
 */
export function Toolbar({ label, wrap, style, children }: { label: string; wrap?: boolean; style?: CSSProperties; children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null)
  const veil = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const toolbar = bar.current
    const cover = veil.current
    if (!toolbar || !cover) return
    const settle = () => {
      const top = toolbar.getBoundingClientRect().top
      const at = stickAt(toolbar)
      cover.style.setProperty('--veil-h', `${at + toolbar.offsetHeight}px`)
      // Stuck is exactly at its place under the header: a toolbar above it was carried off by the end of its section.
      cover.toggleAttribute('data-stuck', Math.abs(top - at) <= 0.5)
    }
    settle()
    const watcher = new ResizeObserver(settle)
    watcher.observe(toolbar)
    watcher.observe(document.body)
    window.addEventListener('scroll', settle, { passive: true })
    return () => {
      watcher.disconnect()
      window.removeEventListener('scroll', settle)
    }
  }, [])
  return (
    <>
      <div className="toolbar-top" aria-hidden="true" />
      <div className="toolbar-veil" aria-hidden="true" ref={veil} />
      <div role="search" aria-label={label} className={`toolbar ${wrap ? 'wrap' : ''}`.trim()} style={style} ref={bar}>
        {children}
      </div>
    </>
  )
}

/**
 * How many games are shown, always on one line of the same height: "84 games", and "12 of 84 games" while a
 * search, a tag or a filter is on, with Clear all at its end. A screen reader hears the count once the person
 * pauses, not on every key.
 */
export function CountLine({ shown, total, active, onClear }: { shown: number; total: number; active: boolean; onClear: () => void }) {
  const noun = (n: number) => (n === 1 ? 'game' : 'games')
  const text = active ? `${shown} of ${total} ${noun(total)}` : `${total} ${noun(total)}`
  const [heard, setHeard] = useState(text)
  useEffect(() => {
    const timer = window.setTimeout(() => setHeard(text), 600)
    return () => window.clearTimeout(timer)
  }, [text])
  return (
    <div className="count-line">
      <span className="count tnum" aria-hidden="true">
        {text}
      </span>
      {active && (
        <button type="button" className="link small" onClick={onClear}>
          Clear all
        </button>
      )}
      <p role="status" className="sr-only">
        {heard}
      </p>
    </div>
  )
}

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
 * `label` names the field, `placeholder` says what it searches.
 */
export default function SearchField({ value, onChange, label, placeholder }: { value: string; onChange: (text: string) => void; label: string; placeholder: string }) {
  const input = useRef<HTMLInputElement>(null)
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
    onChange(text)
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
        placeholder={placeholder}
        value={value}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && isTouchDevice()) input.current?.blur()
          if (e.key !== 'Escape') return
          if (value) change('')
          else input.current?.blur()
        }}
      />
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
