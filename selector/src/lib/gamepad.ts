/*
 * A controller moves around Renplay like a keyboard: the d-pad or left stick moves focus (through the
 * arrow keys first, so rows and grids that handle them keep doing so), A presses, B is Escape. While
 * a game has focus the game has the controller (renplay-runtime.js), and its Menu button opens the
 * player's drawer. With the drawer open, Menu here closes it (the 'renplay:pad-menu' event).
 */

import { FOCUSABLE } from '../lantern/modal'

const REPEAT_AFTER = 400
const REPEAT_EVERY = 120

const shown = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** The topmost open dialog or sheet, or the page. */
function scope(): ParentNode {
  const open = [...document.querySelectorAll<HTMLElement>('[role=dialog], dialog[open]')].filter(shown)
  return open[open.length - 1] ?? document
}

function moveFocus(step: 1 | -1): void {
  const all = [...scope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown)
  if (!all.length) return
  const i = all.indexOf(document.activeElement as HTMLElement)
  const next = all[i < 0 ? (step > 0 ? 0 : all.length - 1) : (i + step + all.length) % all.length]!
  next.focus({ focusVisible: true } as FocusOptions)
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/** Sends a key to what has focus. True when something handled it. */
function key(name: string): boolean {
  const target = (document.activeElement as HTMLElement | null) ?? document.body
  const down = new KeyboardEvent('keydown', { key: name, code: name, bubbles: true, cancelable: true })
  target.dispatchEvent(down)
  target.dispatchEvent(new KeyboardEvent('keyup', { key: name, code: name, bubbles: true }))
  return down.defaultPrevented
}

type Input = 'a' | 'b' | 'menu' | 'up' | 'down' | 'left' | 'right'

function act(input: Input): void {
  switch (input) {
    case 'up':
    case 'down':
    case 'left':
    case 'right': {
      const arrow = `Arrow${input[0]!.toUpperCase()}${input.slice(1)}`
      if (!key(arrow)) moveFocus(input === 'down' || input === 'right' ? 1 : -1)
      break
    }
    case 'a': {
      const el = document.activeElement as HTMLElement | null
      if (el && el !== document.body && el.matches(FOCUSABLE)) el.click()
      else moveFocus(1)
      break
    }
    case 'b':
      key('Escape')
      break
    case 'menu':
      window.dispatchEvent(new Event('renplay:pad-menu'))
      break
  }
}

/** What each pad holds now, in the standard mapping. */
function read(): Set<Input> {
  const held = new Set<Input>()
  for (const p of navigator.getGamepads?.() ?? []) {
    if (!p || !p.connected || p.mapping !== 'standard') continue
    const b = (i: number) => !!p.buttons[i]?.pressed
    const [x = 0, y = 0] = p.axes
    if (b(0)) held.add('a')
    if (b(1)) held.add('b')
    if (b(9)) held.add('menu')
    if (b(12) || y < -0.5) held.add('up')
    if (b(13) || y > 0.5) held.add('down')
    if (b(14) || x < -0.5) held.add('left')
    if (b(15) || x > 0.5) held.add('right')
  }
  return held
}

let running = false
let gameHasPad = false

/** While a game plays and its drawer is closed, the game has the controller, wherever focus is. */
export function setGameHasPad(on: boolean): void {
  gameHasPad = on
}

/** Starts listening once a controller connects. Call once. */
export function installGamepad(): void {
  if (!('getGamepads' in navigator)) return
  const since = new Map<Input, number>()
  const repeated = new Map<Input, number>()
  const tick = (now: number) => {
    const pads = [...navigator.getGamepads()].filter((p) => p?.connected)
    if (!pads.length) {
      running = false
      return
    }
    const held = read()
    // A game in a frame with focus has the controller. Buttons it was given count as held here, so
    // the press that opened the drawer does not reach the drawer as a new one.
    if (gameHasPad || document.activeElement?.tagName === 'IFRAME') {
      for (const input of held) if (!since.has(input)) since.set(input, now)
      for (const input of [...since.keys()]) if (!held.has(input)) since.delete(input)
      requestAnimationFrame(tick)
      return
    }
    for (const input of held) {
      const start = since.get(input)
      if (start === undefined) {
        since.set(input, now)
        repeated.set(input, now)
        act(input)
      } else if (['up', 'down', 'left', 'right'].includes(input) && now - start > REPEAT_AFTER && now - repeated.get(input)! > REPEAT_EVERY) {
        repeated.set(input, now)
        act(input)
      }
    }
    for (const input of [...since.keys()]) if (!held.has(input)) since.delete(input)
    requestAnimationFrame(tick)
  }
  const start = () => {
    if (running) return
    running = true
    requestAnimationFrame(tick)
  }
  window.addEventListener('gamepadconnected', start)
  if ([...navigator.getGamepads()].some((p) => p?.connected)) start()
}
