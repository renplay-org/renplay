import { useEffect } from 'react'
import { FOCUSABLE } from './modal'
import { reducedMotion } from './travel'

/** The arrow keys a controller sends (lib/gamepad.ts). They go the same way to what has focus, but the page's tiles do not take them from outside: a controller moves focus by where things are (`moveSpatial`). */
export const padKeys = new WeakSet<Event>()

/** What a controller can land on in `root`: laid out, not hidden, not inert, not a stop the page keeps out of the tab order (the stage's cover link repeats its buttons). */
export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert], [aria-hidden="true"]') && el.getAttribute('tabindex') !== '-1'
  })
}

/** The same without the controls that hold other controls (the carousel's box): a place to be inside of, not a target. */
const targets = (root: ParentNode): HTMLElement[] => {
  const all = focusables(root)
  return all.filter((el) => !all.some((other) => other !== el && el.contains(other)))
}

/** The bars that stay on the screen while the page scrolls under them: they cover what is behind, so they never need scrolling to. */
const CHROME = '.top, .toolbar, .tabbar'

/** How far from the edges of the screen a control is kept when it is scrolled to. */
const MARGIN = 12

/**
 * Brings what has focus fully into view: under the header and the toolbar stuck below it, above the tab bar on a
 * phone. The page's own scroll padding is not used: a field in the toolbar would count as hidden under it, and the
 * browser would scroll the page on every key typed. Instant: a controller moves again before a glide would finish,
 * and the next move then reads where things really are.
 */
export function reveal(el: HTMLElement): void {
  if (el.closest(CHROME)) return
  const bottomOf = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? 0
  const bar = document.querySelector('.tabbar')
  const tabs = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().height : 0
  const root = document.documentElement.style
  root.scrollPaddingTop = `${Math.max(bottomOf('.top'), bottomOf('.toolbar-glass[data-stuck]')) + MARGIN}px`
  root.scrollPaddingBottom = `${tabs + MARGIN}px`
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  root.removeProperty('scroll-padding-top')
  root.removeProperty('scroll-padding-bottom')
}

export type Direction = 'up' | 'down' | 'left' | 'right'

/** Focus goes in: to the first control the person can see in the page's content (else in `root`), in reading order. False when there is none. */
export function enter(root: ParentNode): boolean {
  const all = targets(root)
  const ceiling = document.querySelector('.top')?.getBoundingClientRect().bottom ?? 0
  const visible = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return r.bottom > ceiling && r.top < innerHeight && r.right > 0 && r.left < innerWidth
  }
  const inView = all.filter(visible)
  const content = root === document ? inView.filter((el) => el.closest('main')) : []
  const first = [...(content.length ? content : inView.length ? inView : all)].sort((a, b) => {
    const [p, q] = [a.getBoundingClientRect(), b.getBoundingClientRect()]
    return p.top - q.top || p.left - q.left
  })[0]
  if (!first) return false
  first.focus({ focusVisible: true, preventScroll: true } as FocusOptions)
  reveal(first)
  return true
}

/**
 * Focuses the nearest control in a direction, by where they are on the screen: what lies straight that way
 * wins over what is nearer but off to the side. From a control that is out of view the move starts from the middle
 * of the screen. False when there is nothing that way.
 */
export function moveSpatial(direction: Direction, root: ParentNode): boolean {
  const current = document.activeElement as HTMLElement | null
  const from = current && current !== document.body && root.contains(current) ? current.getBoundingClientRect() : null
  // Nothing has focus yet: the first press goes in, whichever way it points.
  if (!from) return enter(root)
  const seen = from && from.bottom > 0 && from.top < innerHeight && from.right > 0 && from.left < innerWidth
  const origin = seen ? from : new DOMRect(innerWidth / 2, innerHeight / 2, 0, 0)
  const vertical = direction === 'up' || direction === 'down'
  const sign = direction === 'down' || direction === 'right' ? 1 : -1
  // Along the way: the gap between the edges. Across it: how far the two do not overlap, which counts double.
  const along = (r: DOMRect) => (vertical ? (sign > 0 ? r.top - origin.bottom : origin.top - r.bottom) : sign > 0 ? r.left - origin.right : origin.left - r.right)
  const across = (r: DOMRect) => (vertical ? Math.max(0, r.left - origin.right, origin.left - r.right) : Math.max(0, r.top - origin.bottom, origin.top - r.bottom))
  const centre = (r: DOMRect) => (vertical ? (sign > 0 ? r.top + r.height / 2 - (origin.top + origin.height / 2) : origin.top + origin.height / 2 - (r.top + r.height / 2)) : sign > 0 ? r.left + r.width / 2 - (origin.left + origin.width / 2) : origin.left + origin.width / 2 - (r.left + r.width / 2))
  let best: HTMLElement | null = null
  let score = Infinity
  for (const el of targets(root)) {
    if (el === current || (current && (el.contains(current) || current.contains(el)))) continue
    const r = el.getBoundingClientRect()
    // Beyond the origin's own middle, or it is not that way at all.
    if (centre(r) <= 4) continue
    const s = Math.max(0, along(r)) + 2 * across(r) + centre(r) * 0.01
    if (s < score) {
      score = s
      best = el
    }
  }
  if (!best) return false
  best.focus({ focusVisible: true, preventScroll: true } as FocusOptions)
  reveal(best)
  return true
}

/**
 * One focus engine for touch, mouse and keyboard. Arrow keys move between the
 * tiles of a shelf or a grid the way they do on a console: left and right
 * along the row, up and down to the nearest tile in that direction. Sheets
 * and text fields keep their own keys.
 */
export function useArrowFocus(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
      const target = e.target as HTMLElement | null
      if (target?.closest('.sheet, .pop, [role="dialog"], input, textarea, select, [contenteditable="true"]')) return
      const items = [...document.querySelectorAll<HTMLElement>('[data-focus]')].filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const cur = document.activeElement?.closest<HTMLElement>('[data-focus]') ?? null
      // Only a key that moves is taken: at an edge it scrolls the page, and a controller moves on.
      if (!cur) {
        // From outside the tiles, down and right enter them. Up and left are left to the page, and a controller moves by place.
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || padKeys.has(e)) return
        e.preventDefault()
        items[0]!.focus()
        return
      }
      // A controller moves again before a glide would finish, and each move then reads where things really are.
      const beh: ScrollBehavior = padKeys.has(e) ? 'instant' : reducedMotion() ? 'auto' : 'smooth'
      const rowOf = (el: HTMLElement) => el.closest('[data-row]')
      const r = cur.getBoundingClientRect()
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const same = items.filter((el) => rowOf(el) === rowOf(cur))
        const j = same.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1)
        const next = same[j]
        if (next) {
          e.preventDefault()
          next.focus({ preventScroll: true })
          if (padKeys.has(e)) reveal(next)
          else next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: beh })
        }
        return
      }
      const dir = e.key === 'ArrowDown' ? 1 : -1
      let best: HTMLElement | null = null
      let bd = Infinity
      for (const el of items) {
        const q = el.getBoundingClientRect()
        if ((q.top - r.top) * dir <= 10) continue
        const d = Math.abs(q.top - r.top) * 2 + Math.abs(q.left - r.left)
        if (d < bd) {
          bd = d
          best = el
        }
      }
      if (best) {
        e.preventDefault()
        best.focus({ preventScroll: true })
        best.scrollIntoView({ block: 'center', behavior: beh })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}
