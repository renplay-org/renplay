import { reducedMotion } from './travel'

/**
 * The lean: the tile under a mouse tilts toward it in 3D and the tiles around it lean a little, as the website's
 * shelf does. A press on a touch screen leans the tile toward the finger, and back when it lifts. What is lit (the
 * border, the glow, the sheen and the lift) is CSS (Tile.css). This module sets the tilt, and where the sheen is.
 *
 * One set of listeners for the page and one frame loop. The loop runs only while the pointer moves or a tile is
 * still settling, and only over the tiles in view: a tile that scrolls out of view is put back at once. Scrolling
 * itself moves nothing, since the pointer did not move. The same-place moves the browser repeats after a scroll are
 * not moves. Reduced motion has no lean.
 */

interface Tile {
  card: HTMLElement
  tilt: HTMLElement
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
/** The most a tile under the pointer tilts, and the most a neighbour does, in degrees. */
const UNDER = 6
const NEIGHBOUR = 7
/** A tile this many of its own widths and heights from the pointer no longer leans. */
const REACH_X = 3.2
const REACH_Y = 2.4
/** The loop's settling time: a tile covers about two thirds of its way each time. */
const EASE_MS = 80
/** How long after the last move the loop keeps going, for the pointer's own pause. */
const IDLE_MS = 120

const tiles = new Map<HTMLElement, Tile>()
const seen = new Set<Tile>()
let observer: IntersectionObserver | null = null
/** A mouse or a pen: where it is, and the tile it is over. */
let pointer: { x: number; y: number } | null = null
let over: Tile | null = null
/** A press: the tile and where on the screen. */
let press: { tile: Tile; x: number; y: number } | null = null
let moved = 0
/** The goals are out of date: the pointer or a press changed since they were worked out. */
let aimed = false
let frame = 0
let last = 0

const clamp = (n: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, n))

function put(t: Tile): void {
  const flat = Math.abs(t.rx) < 0.02 && Math.abs(t.ry) < 0.02
  if (flat && t !== over && t !== press?.tile) {
    if (!t.live) return
    t.tilt.style.transform = ''
    t.tilt.style.removeProperty('--gx')
    t.tilt.style.removeProperty('--gy')
    t.live = false
    return
  }
  t.tilt.style.transform = `rotateY(${t.ry.toFixed(2)}deg) rotateX(${t.rx.toFixed(2)}deg)`
  t.tilt.style.setProperty('--gx', `${t.gx.toFixed(0)}%`)
  t.tilt.style.setProperty('--gy', `${t.gy.toFixed(0)}%`)
  t.live = true
}

/** Where a tile wants to be: [rotateX, rotateY, sheenX, sheenY]. */
function aim(t: Tile, r: DOMRect): [number, number, number, number] {
  const at = press?.tile === t ? press : over === t ? pointer : null
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  if (at) {
    // Under the hand: toward it by where it is on the tile, the sheen right under it.
    const lx = clamp((at.x - cx) / (r.width / 2))
    const ly = clamp((at.y - cy) / (r.height / 2))
    return [-ly * UNDER, lx * UNDER, 50 + lx * 45, 50 + ly * 45]
  }
  if (!pointer || press) return [0, 0, REST_X, REST_Y]
  const dx = pointer.x - cx
  const dy = pointer.y - cy
  // Falling to nothing a little before the edge of its reach, so what is far from the pointer is at rest, not nearly.
  const near = Math.max(0, (1 - Math.hypot(dx / (r.width * REACH_X), dy / (r.height * REACH_Y)) - 0.15) / 0.85)
  if (!near) return [0, 0, REST_X, REST_Y]
  const nx = clamp(dx / (r.width * 1.5))
  const ny = clamp(dy / (r.height * 1.5))
  return [-ny * NEIGHBOUR * near, nx * NEIGHBOUR * near, REST_X + nx * 45 * near, REST_Y + ny * 45 * near]
}

function step(now: number): void {
  frame = 0
  const dt = Math.min(64, now - last)
  last = now
  const k = 1 - Math.exp(-dt / EASE_MS)
  const list = [...seen]
  if (aimed) {
    aimed = false
    // Every read before any write, so the loop costs one layout at most.
    const rects = list.map((t) => t.card.getBoundingClientRect())
    list.forEach((t, i) => (t.goal = aim(t, rects[i]!)))
  }
  let settling = false
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

function onMove(e: PointerEvent): void {
  if (e.pointerType === 'touch' || reducedMotion()) return
  // The browser repeats the last position after a scroll: that is not the pointer moving.
  if (pointer && pointer.x === e.clientX && pointer.y === e.clientY) return
  pointer = { x: e.clientX, y: e.clientY }
  over = tiles.get((e.target as Element | null)?.closest<HTMLElement>('.card') as HTMLElement) ?? null
  // A tile under the pointer is in view, whether or not the observer has said so yet.
  if (over) seen.add(over)
  moved = performance.now()
  aimed = true
  run()
}

function onLeave(e: PointerEvent): void {
  if (e.relatedTarget || e.pointerType === 'touch') return
  pointer = null
  over = null
  aimed = true
  run()
}

function onDown(e: PointerEvent): void {
  if (reducedMotion() || (e.pointerType === 'mouse' && e.button !== 0)) return
  const tile = tiles.get((e.target as Element | null)?.closest<HTMLElement>('.card') as HTMLElement)
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

function listen(on: boolean): void {
  const act = on ? document.addEventListener.bind(document) : document.removeEventListener.bind(document)
  act('pointermove', onMove as EventListener, { passive: true })
  act('pointerout', onLeave as EventListener)
  act('pointerdown', onDown as EventListener, { passive: true })
  act('pointerup', onUp)
  act('pointercancel', onUp)
}

/**
 * A tile joins the lean: `card` is the `.card` link with its `.tilt` inside. Returns what takes it out again.
 */
export function leanTile(card: HTMLElement): () => void {
  const tilt = card.querySelector<HTMLElement>('.tilt')
  if (!tilt) return () => {}
  const tile: Tile = { card, tilt, rx: 0, ry: 0, gx: REST_X, gy: REST_Y, goal: [0, 0, REST_X, REST_Y], live: false }
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
