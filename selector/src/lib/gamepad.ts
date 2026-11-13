/*
 * A controller moves around Renplay like a keyboard: the d-pad or left stick moves focus (through the
 * arrow keys first, so rows and grids that handle them keep doing so), A presses, B is Escape. While
 * a game has focus the game has the controller (renplay-runtime.js), and its Menu button opens the
 * player's drawer. With the drawer open, Menu here closes it (the 'renplay:pad-menu' event).
 */

import { useSyncExternalStore } from 'react'
import { FOCUSABLE } from '../lantern/modal'

const REPEAT_AFTER = 400
const REPEAT_EVERY = 120

const shown = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** The guide has focus: it holds the controller. Parked, with focus in the game or the menu, it does not. */
const guideHasFocus = (): boolean => !!(document.activeElement as HTMLElement | null)?.closest?.('[data-guide-window]')

/** The topmost open dialog or sheet, or the page. The guide, a layer beside the game, is the topmost only while it holds focus. */
function scope(): ParentNode {
  const held = guideHasFocus()
  const open = [...document.querySelectorAll<HTMLElement>('[role=dialog], dialog[open]')].filter((el) => shown(el) && (held || !el.hasAttribute('data-guide-window')))
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

type Input = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'menu' | 'up' | 'down' | 'left' | 'right'

/** What the guide does with the buttons while it holds the controller: they go to it as an event (components/GuideWindow.tsx). */
const toGuide = (input: Input) => window.dispatchEvent(new CustomEvent('renplay:guide-pad', { detail: input }))

function act(input: Input): void {
  if (input !== 'a' && input !== 'menu' && guideHasFocus()) {
    toGuide(input)
    return
  }
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

/** Menu held this long, with the guide holding the controller, parks the guide instead of opening the menu. */
const HOLD = 500

/** What each pad holds now, in the standard mapping. */
function read(): Set<Input> {
  const held = new Set<Input>()
  for (const p of navigator.getGamepads?.() ?? []) {
    if (!p || !p.connected || p.mapping !== 'standard') continue
    const b = (i: number) => !!p.buttons[i]?.pressed
    const [x = 0, y = 0] = p.axes
    if (b(0)) held.add('a')
    if (b(1)) held.add('b')
    if (b(2)) held.add('x')
    if (b(3)) held.add('y')
    if (b(4)) held.add('lb')
    if (b(5)) held.add('rb')
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
let menuHeld = { guide: false, parked: false }

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
      menuHeld = { guide: false, parked: false }
      for (const input of [...since.keys()]) if (!held.has(input)) since.delete(input)
      requestAnimationFrame(tick)
      return
    }
    // Menu: a press opens the menu or closes it. With the guide holding the controller a press waits to see whether it is held.
    const menu = held.has('menu')
    if (menu && !since.has('menu')) {
      since.set('menu', now)
      menuHeld = { guide: guideHasFocus(), parked: false }
      if (!menuHeld.guide) act('menu')
    } else if (menu && menuHeld.guide && !menuHeld.parked && now - since.get('menu')! >= HOLD) {
      menuHeld.parked = true
      toGuide('b')
    } else if (!menu && since.has('menu')) {
      if (menuHeld.guide && !menuHeld.parked) act('menu')
      since.delete('menu')
    }
    held.delete('menu')
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
    for (const input of [...since.keys()]) if (input !== 'menu' && !held.has(input)) since.delete(input)
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

const padsConnected = () => [...(navigator.getGamepads?.() ?? [])].some((p) => p?.connected)

/** Whether a controller is connected now: the pill and the menu then name its buttons, not the keys. */
export function useGamepadConnected(): boolean {
  return useSyncExternalStore(
    (on) => {
      window.addEventListener('gamepadconnected', on)
      window.addEventListener('gamepaddisconnected', on)
      return () => {
        window.removeEventListener('gamepadconnected', on)
        window.removeEventListener('gamepaddisconnected', on)
      }
    },
    padsConnected,
  )
}
