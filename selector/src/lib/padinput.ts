/*
 * What the controller is doing, one frame at a time: the buttons held, the one direction pressed (the d-pad
 * and the left stick count as one, so a press is one move however it is made) and how far the right stick
 * pushes. gamepad.ts turns these into focus moves and clicks.
 */

import type { Direction } from '../lantern/focus'

export type Button = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'menu'

/** The stick presses at this far from the middle and lets go below RELEASE: between them it keeps what it was doing, so a thumb resting near either does not toggle. */
const PRESS = 0.6
const RELEASE = 0.35
/** The right stick scrolls beyond this, from nothing at the edge of the dead zone to full speed at the end. */
const SCROLL_DEAD = 0.2

/** A held direction moves again after this long, then every `REPEAT_FIRST`, a little faster each time down to `REPEAT_MIN`. */
const REPEAT_AFTER = 550
const REPEAT_FIRST = 200
const REPEAT_MIN = 80
const REPEAT_SPEEDUP = 0.88

/** How long to wait after the move number `n` (counting from 1) of a held direction before the next. */
const repeatEvery = (n: number): number => Math.max(REPEAT_MIN, REPEAT_FIRST * REPEAT_SPEEDUP ** (n - 1))

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' }
const DPAD: Array<[Direction, number]> = [
  ['up', 12],
  ['down', 13],
  ['left', 14],
  ['right', 15],
]
const FACE: Array<[Button, number]> = [
  ['a', 0],
  ['b', 1],
  ['x', 2],
  ['y', 3],
  ['lb', 4],
  ['rb', 5],
  ['menu', 9],
]

/** The pads that follow the standard layout, which is all this reads. */
const standard = () => [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard')

/** Whether a controller is connected, of any layout. */
export const connected = () => [...(navigator.getGamepads?.() ?? [])].some((p) => p?.connected)

/** The direction a stick is held in, with a radial dead zone and hysteresis, or null. `was` is what it did the frame before. */
function stickDirection(x: number, y: number, was: Direction | null): Direction | null {
  const reach = Math.hypot(x, y)
  if (reach < (was ? RELEASE : PRESS)) return null
  // The longer axis names the direction. Across the middle in one frame (a flick) the opposite one is a new press.
  const now: Direction = Math.abs(y) >= Math.abs(x) ? (y < 0 ? 'up' : 'down') : x < 0 ? 'left' : 'right'
  if (!was || reach < PRESS) return was ?? now
  return now === OPPOSITE[was] ? now : was
}

export interface Reading {
  buttons: Set<Button>
  /** The one direction held, from the d-pad first, else the left stick. */
  direction: Direction | null
  /** The right stick beyond its dead zone, -1 to 1 along each axis, up and left negative. */
  scroll: { x: number; y: number }
}

let dpadWas: Direction | null = null
let stickWas: Direction | null = null

/** What every controller holds now. */
export function read(): Reading {
  const buttons = new Set<Button>()
  const dpad = new Set<Direction>()
  let stick: Direction | null = null
  const scroll = { x: 0, y: 0 }
  for (const p of standard()) {
    const b = (i: number) => !!p.buttons[i]?.pressed
    for (const [name, i] of FACE) if (b(i)) buttons.add(name)
    for (const [name, i] of DPAD) if (b(i)) dpad.add(name)
    const [x = 0, y = 0, rx = 0, ry = 0] = p.axes
    stick ??= stickDirection(x, y, stickWas)
    const reach = Math.hypot(rx, ry)
    if (reach > SCROLL_DEAD) {
      const k = (reach - SCROLL_DEAD) / (1 - SCROLL_DEAD) / reach
      scroll.x += rx * k
      scroll.y += ry * k
    }
  }
  // The d-pad keeps the direction it began with while that button is held, so two buttons together (a diagonal) are not two presses.
  dpadWas = dpadWas && dpad.has(dpadWas) ? dpadWas : (DPAD.map(([name]) => name).find((name) => dpad.has(name)) ?? null)
  stickWas = stick
  return { buttons, direction: dpadWas ?? stick, scroll }
}

/** Counts a held direction into moves: one when it is pressed, then repeats, a little faster each time. `absorb` takes a direction as already held, with no move (the game had the controller). */
export function directionRepeater(move: (direction: Direction) => void) {
  let held: Direction | null = null
  let next = 0
  let moves = 0
  const begin = (direction: Direction | null, now: number) => {
    held = direction
    moves = 0
    next = now + REPEAT_AFTER
  }
  return {
    step(direction: Direction | null, now: number) {
      if (direction !== held) {
        begin(direction, now)
        if (direction) move(direction)
      } else if (direction && now >= next) {
        moves++
        next = now + repeatEvery(moves)
        move(direction)
      }
    },
    absorb(direction: Direction | null, now: number) {
      if (direction !== held) begin(direction, now)
    },
  }
}
