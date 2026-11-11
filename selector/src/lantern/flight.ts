import { useLayoutEffect } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { browserEngine } from '../lib/platform'
import { flyGhost, reducedMotion } from './travel'

/**
 * The flight back: leaving a game page by going back (the back button, the browser's back, a trackpad
 * swipe: all of them are `popstate`) flies the stage's cover back to the tile it came from. The cover is
 * noted when the pop happens, while the game page is still there, and flown once the page before it has
 * rendered and restored its scroll. A tile that is not on screen gets no flight.
 */

interface Leaving {
  id: string
  src: string | null
  rect: DOMRect
  /** The browser's own swipe is on screen with its snapshot: the flight is short, so the two do not fight. */
  short: boolean
}

let leaving: Leaving | null = null
/** The page showing now, and the one before it. */
let at = ''
let ownBack = false
let lastSwipe = 0

/** The pages with tiles, where a game page's back button returns to: Renplay's own history, not the player's. */
let previous = ''
export function cameFromList(): boolean {
  return previous === '/' || previous === '/catalog'
}

/** The page's own back button: goes back (so the flight back can follow), with no browser animation next to it. */
export function useGoBack(): () => void {
  const navigate = useNavigate()
  return () => {
    ownBack = true
    window.setTimeout(() => (ownBack = false), 1000)
    navigate(-1)
  }
}

/** A trackpad's two-finger swipe sideways sends mostly horizontal wheel events just before the pop. */
window.addEventListener('wheel', (e) => (lastSwipe = Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5 ? performance.now() : lastSwipe), { passive: true })

const SHORT_MS = 180
const MIN_SHOWN = 0.6

/** The share of a box inside the part of the screen between the header and the tab bar. */
function shown(r: DOMRect): number {
  const top = document.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0
  const tabs = document.querySelector('.tabbar')?.getBoundingClientRect()
  const bottom = tabs && tabs.height && getComputedStyle(document.querySelector('.tabbar')!).display !== 'none' ? tabs.top : window.innerHeight
  const visible = Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, top)) * Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0))
  return r.width && r.height ? visible / (r.width * r.height) : 0
}

function note(): void {
  const cover = document.querySelector<HTMLElement>('main .stage .cover .frame')
  const id = document.querySelector<HTMLElement>('main .stage')?.dataset['id']
  if (!cover || !id) return
  const rect = cover.getBoundingClientRect()
  if (shown(rect) < MIN_SHOWN) return
  const img = cover.querySelector<HTMLImageElement>('img.art:not(.loading)') ?? cover.querySelector<HTMLImageElement>('img.ph')
  const swiped = performance.now() - lastSwipe < 800
  leaving = { id, src: img?.currentSrc || img?.src || null, rect, short: swiped || (browserEngine() === 'webkit' && !ownBack) }
}

function land(l: Leaving): void {
  // The cover of the carousel's slide first (the Library's top), then the game's tiles.
  const places = [...document.querySelectorAll<HTMLElement>('main .carousel .slide:not(.copy) .stage[data-id], main .card[data-id]')].filter((t) => t.dataset['id'] === l.id)
  for (const place of places) {
    const frame = place.querySelector<HTMLElement>(place.matches('.stage') ? '.cover .frame' : '.frame')
    const rect = frame?.getBoundingClientRect()
    if (!frame || !rect || shown(rect) < MIN_SHOWN) continue
    frame.style.visibility = 'hidden'
    flyGhost({ id: l.id, src: l.src, rect: { x: l.rect.x, y: l.rect.y, w: l.rect.width, h: l.rect.height } }, { x: rect.x, y: rect.y, w: rect.width, h: rect.height }, () => (frame.style.visibility = ''), l.short ? SHORT_MS : 480)
    return
  }
}

/**
 * Listening from the start, before the router does: its own listener renders the page before this one
 * on the same pop, and the game page's cover would be gone.
 */
window.addEventListener('popstate', () => {
  leaving = null
  if (at.startsWith('/game/') && !reducedMotion()) note()
  ownBack = false
})

/** In the shell: fly the noted cover when the page before the game page is in place. */
export function useFlightBack(): void {
  const location = useLocation()
  const type = useNavigationType()
  // Noted while rendering, since the page that renders next (the game page) asks where it came from.
  if (at !== location.pathname) {
    previous = at
    at = location.pathname
  }
  // After the scroll's restoring (AppShell's, in a layout effect and once more a frame later).
  useLayoutEffect(() => {
    if (type !== 'POP' || !leaving) return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const l = leaving
        leaving = null
        if (l) land(l)
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [location.key, type])
}
