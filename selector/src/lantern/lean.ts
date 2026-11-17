import { cardsMove } from '../lib/cardmotion'
import { reducedMotion } from './travel'

/**
 * The lean, the website's shelf: every tile in view leans toward the hand, the one under it more, and the sheen
 * looks that way too. The hand is the pointer a little late and a tile is its goal a little late (the shelf's two
 * easings), so it all settles instead of snapping. The game under the hand also lights the grid behind it in its colour.
 * A press on a touch screen leans the tile toward the finger, and back when it lifts. What is lit (the border, the glow,
 * the sheen and the lift) is CSS (Tile.css). This module sets the tilt, where the sheen is, and the grid's light.
 *
 * One set of listeners for the page and one frame loop. The loop runs only while the pointer moves or a tile is
 * still settling, and only over the tiles in view: a tile that scrolls out of view is put back at once. Scrolling
 * itself moves nothing, since the pointer did not move. The same-place moves the browser repeats after a scroll are
 * not moves. Reduced motion has no lean, and nor has a browser that turned the movement off (lib/cardmotion.ts).
 */

interface Tile {
  card: HTMLElement
  tilt: HTMLElement
  /** The soft-light disc over the picture. Its own element, so that moving it restyles one element and not the tile. */
  sheen: HTMLElement
  rx: number
  ry: number
  gx: number
  gy: number
  /** Where it is going, set when the pointer moves. A scroll moves the tile under a pointer that is still, and does not change this. */
  goal: [number, number, number, number]
  /** Whether the inline transform and sheen are set now. */
  live: boolean
}

/** The sheen's place when nothing is near, as in Tile.css. */
const REST_X = 50
const REST_Y = 30
/** The shelf's lean: a tile leans by the hand's offset over these, at most 1, times these degrees. */
const SPAN_X = 520
const SPAN_Y = 420
const LEAN_Y = 9
const LEAN_X = 7
/** The tile under the hand leans this much more. */
const UNDER = 1.7
/** The sheen's reach, in percent, from where it sits at rest. */
const SHEEN = 45
/** A touch press leans the tile it is on by this many degrees at the tile's edge. */
const PRESS = 6
/** Settling times in ms. The shelf moves 10 percent of the way a frame to the hand and 12 to the goal at 60 fps. */
const HAND_MS = 158
const EASE_MS = 130
/** How long after the last move the loop keeps going, for the pointer's own pause. */
const IDLE_MS = 120

const tiles = new Map<HTMLElement, Tile>()
const seen = new Set<Tile>()
let observer: IntersectionObserver | null = null
/** A mouse or a pen: where it is, and the tile it is over. The hand is where the tiles lean to, the pointer eased. */
let pointer: { x: number; y: number } | null = null
const hand = { x: 0, y: 0 }
let over: Tile | null = null
/** The tile that lights its grid or shelf now, and that grid or shelf. `wanted` is the next one, done in the next frame. */
let litTile: Tile | null = null
let lit: HTMLElement | null = null
let wanted: Tile | null | undefined
/** A press: the tile and where on the screen. */
let press: { tile: Tile; x: number; y: number } | null = null
let moved = 0
/** The goals are out of date: the pointer or a press changed since they were worked out. */
let aimed = false
let frame = 0
let last = 0

/** No lean: the device asks for reduced motion, or this browser turned the movement off. */
const still = () => reducedMotion() || !cardsMove()

const clamp = (n: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, n))

function put(t: Tile): void {
  const flat = Math.abs(t.rx) < 0.02 && Math.abs(t.ry) < 0.02
  if (flat && t !== over && t !== press?.tile) {
    if (!t.live) return
    t.tilt.style.transform = ''
    t.sheen.style.removeProperty('--gx')
    t.sheen.style.removeProperty('--gy')
    t.live = false
    return
  }
  t.tilt.style.transform = `perspective(900px) rotateY(${t.ry.toFixed(2)}deg) rotateX(${t.rx.toFixed(2)}deg)`
  t.sheen.style.setProperty('--gx', `${t.gx.toFixed(0)}%`)
  t.sheen.style.setProperty('--gy', `${t.gy.toFixed(0)}%`)
  t.live = true
}

/** Where a tile wants to be: [rotateX, rotateY, sheenX, sheenY]. */
function aim(t: Tile, r: DOMRect): [number, number, number, number] {
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  if (press) {
    if (press.tile !== t) return [0, 0, REST_X, REST_Y]
    // A finger on it: toward the finger by where it is on the tile, the sheen right under it.
    const lx = clamp((press.x - cx) / (r.width / 2))
    const ly = clamp((press.y - cy) / (r.height / 2))
    return [-ly * PRESS, lx * PRESS, 50 + lx * SHEEN, 50 + ly * SHEEN]
  }
  if (!pointer) return [0, 0, REST_X, REST_Y]
  const nx = clamp((hand.x - cx) / SPAN_X)
  const ny = clamp((hand.y - cy) / SPAN_Y)
  const k = over === t ? UNDER : 1
  return [-ny * LEAN_X * k, nx * LEAN_Y * k, REST_X + nx * SHEEN, 35 + ny * SHEEN]
}

function step(now: number): void {
  frame = 0
  const dt = Math.min(64, now - last)
  last = now
  const k = 1 - Math.exp(-dt / EASE_MS)
  let settling = false
  if (pointer) {
    const hk = 1 - Math.exp(-dt / HAND_MS)
    const gx = pointer.x - hand.x
    const gy = pointer.y - hand.y
    if (Math.abs(gx) > 0.5 || Math.abs(gy) > 0.5) {
      hand.x += gx * hk
      hand.y += gy * hk
      aimed = true
      settling = true
    } else {
      hand.x = pointer.x
      hand.y = pointer.y
    }
  }
  const list = [...seen]
  // Every read before any write, so the loop costs one layout at most.
  const rects = aimed ? list.map((t) => t.card.getBoundingClientRect()) : []
  if (wanted !== undefined) {
    light(wanted)
    wanted = undefined
  }
  if (aimed) {
    aimed = false
    list.forEach((t, i) => (t.goal = aim(t, rects[i]!)))
  }
  for (const t of list) {
    const keys = ['rx', 'ry', 'gx', 'gy'] as const
    keys.forEach((key, n) => {
      const gap = t.goal[n] - t[key]
      if (Math.abs(gap) > (n > 1 ? 0.5 : 0.02)) {
        t[key] += gap * k
        settling = true
      } else t[key] = t.goal[n]
    })
    put(t)
  }
  if (settling || (pointer && now - moved < IDLE_MS)) run()
}

function run(): void {
  if (frame) return
  last = performance.now()
  frame = requestAnimationFrame(step)
}

function reset(t: Tile): void {
  t.rx = t.ry = 0
  t.gx = REST_X
  t.gy = REST_Y
  t.goal = [0, 0, REST_X, REST_Y]
  if (over === t) over = null
  if (press?.tile === t) press = null
  delete t.card.dataset['press']
  put(t)
}

/**
 * The grid or shelf behind a tile lights up in the tile's colour, where the tile is, and fades when nothing is lit
 * (Tile.css). It has two lamps that take turns, so a move from tile to tile is a crossfade.
 */
function light(t: Tile | null): void {
  litTile = t
  const row = t?.card.closest<HTMLElement>('[data-row]') ?? null
  if (lit && lit !== row) delete lit.dataset['glow']
  lit = row
  if (!t || !row) return
  const r = t.card.getBoundingClientRect()
  const h = row.getBoundingClientRect()
  const lamp = row.dataset['glow'] === 'a' ? 'b' : 'a'
  const x = r.left - h.left + row.scrollLeft + r.width / 2
  const y = r.top - h.top + row.scrollTop + r.height / 2
  row.style.setProperty(`--glow-${lamp}`, t.card.style.getPropertyValue('--tint'))
  row.style.setProperty(`--glow-${lamp}-x`, `${x.toFixed(0)}px`)
  row.style.setProperty(`--glow-${lamp}-y`, `${y.toFixed(0)}px`)
  row.dataset['glow'] = lamp
}

const tileAt = (target: EventTarget | null) => tiles.get((target as Element | null)?.closest<HTMLElement>('.card') as HTMLElement)

function onMove(e: PointerEvent): void {
  if (e.pointerType === 'touch') return
  // The browser repeats the last position after a scroll: that is not the pointer moving.
  if (pointer && pointer.x === e.clientX && pointer.y === e.clientY) return
  const under = tileAt(e.target) ?? null
  // The tiles lean toward a pointer that is over a grid or a shelf, in a tile or in a gap. Over anything else (the header,
  // the stage, a sheet) the pointer is as good as gone: they rest and the light goes out.
  const inRow = !!(e.target as Element | null)?.closest('[data-row]')
  if (under !== litTile && (under || !inRow)) {
    wanted = under
    run()
  }
  if (still()) return
  if (!inRow) {
    if (pointer) {
      pointer = null
      over = null
      aimed = true
      run()
    }
    return
  }
  if (!pointer) {
    hand.x = e.clientX
    hand.y = e.clientY
  }
  pointer = { x: e.clientX, y: e.clientY }
  over = under
  // A tile under the pointer is in view, whether or not the observer has said so yet.
  if (over) seen.add(over)
  moved = performance.now()
  aimed = true
  run()
}

function onLeave(e: PointerEvent): void {
  if (e.relatedTarget || e.pointerType === 'touch') return
  wanted = null
  pointer = null
  over = null
  aimed = true
  run()
}

/** The keyboard and a controller light the grid behind the focused tile too, until the pointer has a tile of its own. */
function onFocus(e: FocusEvent): void {
  const tile = tileAt(e.target)
  if (tile && (e.target as Element).matches(':focus-visible')) {
    wanted = tile
    run()
  }
}

function onBlur(e: FocusEvent): void {
  if (litTile && e.target === litTile.card) {
    wanted = over
    run()
  }
}

function onDown(e: PointerEvent): void {
  if (still() || (e.pointerType === 'mouse' && e.button !== 0)) return
  const tile = tileAt(e.target)
  if (!tile) return
  press = { tile, x: e.clientX, y: e.clientY }
  seen.add(tile)
  tile.card.dataset['press'] = ''
  aimed = true
  run()
}

function onUp(): void {
  if (!press) return
  delete press.tile.card.dataset['press']
  press = null
  aimed = true
  run()
}

/** The browser's choice changed to still: every tile that leans is put back, and nothing waits for the pointer. */
function onStill(): void {
  if (!still()) return
  pointer = null
  over = null
  press = null
  aimed = true
  for (const t of tiles.values()) reset(t)
}

function listen(on: boolean): void {
  const act = on ? document.addEventListener.bind(document) : document.removeEventListener.bind(document)
  act('pointermove', onMove as EventListener, { passive: true })
  act('pointerout', onLeave as EventListener)
  act('pointerdown', onDown as EventListener, { passive: true })
  act('pointerup', onUp)
  act('pointercancel', onUp)
  act('focusin', onFocus as EventListener)
  act('focusout', onBlur as EventListener)
  act('renplay:card-motion', onStill)
}

/**
 * A tile joins the lean: `card` is the `.card` link with its `.tilt` inside. Returns what takes it out again.
 */
export function leanTile(card: HTMLElement): () => void {
  const tilt = card.querySelector<HTMLElement>('.tilt')
  const sheen = card.querySelector<HTMLElement>('.sheen')
  if (!tilt || !sheen) return () => {}
  const tile: Tile = { card, tilt, sheen, rx: 0, ry: 0, gx: REST_X, gy: REST_Y, goal: [0, 0, REST_X, REST_Y], live: false }
  if (!tiles.size) {
    listen(true)
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const t = tiles.get(entry.target as HTMLElement)
          if (!t) continue
          if (entry.isIntersecting) seen.add(t)
          else {
            seen.delete(t)
            reset(t)
          }
        }
      },
      { rootMargin: '60px' },
    )
  }
  tiles.set(card, tile)
  observer!.observe(card)
  return () => {
    observer?.unobserve(card)
    seen.delete(tile)
    reset(tile)
    tiles.delete(card)
    if (litTile === tile) light(null)
    if (!tiles.size) {
      listen(false)
      observer?.disconnect()
      observer = null
      cancelAnimationFrame(frame)
      frame = 0
      pointer = null
    }
  }
}

/**
 * Where a tile's picture is on the screen with no tilt and no lift: the card's own box (the lean never moves it) and the
 * frame's shape in it. Anything that is not a tile is measured as it is.
 */
export function restRect(frame: HTMLElement): { x: number; y: number; w: number; h: number } {
  const card = frame.closest<HTMLElement>('.card')
  if (!card) {
    const r = frame.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }
  const r = card.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: (r.width * frame.offsetHeight) / frame.offsetWidth }
}
