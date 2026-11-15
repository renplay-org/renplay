/*
 * A controller moves around Renplay like a keyboard: the d-pad or left stick moves focus (through the
 * arrow keys first, so controls that handle them keep doing so, then to the nearest control that way), A
 * presses, B is Escape, the right stick scrolls and LB and RB switch between the pages. While a game has
 * focus the game has the controller (renplay-runtime.js), and its Menu button opens the player's drawer.
 * With the drawer open, Menu here closes it (the 'renplay:pad-menu' event). What the pad does with each
 * button is in padinput.ts: one direction at a time, with a dead zone, and a repeat that starts late.
 */

import { useSyncExternalStore } from 'react'
import { enter, focusables, padKeys, moveSpatial, reveal, type Direction } from '../lantern/focus'
import { FOCUSABLE } from '../lantern/modal'
import { connected, directionRepeater, read, type Button } from './padinput'


const shown = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

/** The guide has focus: it holds the controller. Parked, with focus in the game or the menu, it does not. */
const guideHasFocus = (): boolean => !!(document.activeElement as HTMLElement | null)?.closest?.('[data-guide-window]')

/** The topmost open dialog, sheet or menu, or the page. The guide, a layer beside the game, is the topmost only while it holds focus. */
function scope(): ParentNode {
  const held = guideHasFocus()
  const open = [...document.querySelectorAll<HTMLElement>('[role=dialog], dialog[open], .pop')].filter((el) => shown(el) && (held || !el.hasAttribute('data-guide-window')))
  return open[open.length - 1] ?? document
}

/** Focuses the control a step along `list`, round the ends, and brings it into view. With focus nowhere the first (or, going back, the last). */
function step(list: HTMLElement[], by: 1 | -1): void {
  if (!list.length) return
  const at = list.indexOf(document.activeElement as HTMLElement)
  const next = list[at < 0 ? (by > 0 ? 0 : list.length - 1) : (at + by + list.length) % list.length]!
  next.focus({ focusVisible: true, preventScroll: true } as FocusOptions)
  reveal(next)
}

/** Sends a key to what has focus, as a controller's own. True when something handled it. */
function key(name: string): boolean {
  const target = (document.activeElement as HTMLElement | null) ?? document.body
  const down = new KeyboardEvent('keydown', { key: name, code: name, bubbles: true, cancelable: true })
  padKeys.add(down)
  target.dispatchEvent(down)
  target.dispatchEvent(new KeyboardEvent('keyup', { key: name, code: name, bubbles: true }))
  return down.defaultPrevented
}

/** What the guide does with the buttons while it holds the controller: they go to it as an event (components/GuideWindow.tsx). */
const toGuide = (input: Button | Direction): void => {
  window.dispatchEvent(new CustomEvent('renplay:guide-pad', { detail: input }))
}

/** The nearest ancestor of `from` that scrolls up and down, or the page. */
function scroller(from: Element | null): HTMLElement | Window {
  for (let el = from; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el as HTMLElement
  }
  return window
}

/** Where the scrolling starts from: what has focus, or the open dialog. */
const scrollFrom = (): Element | null => {
  const active = document.activeElement
  const root = scope()
  return active && active !== document.body && (root === document || (root as Element).contains(active)) ? active : root === document ? null : (root as Element)
}

/** Nothing to move to up or down: the page, or the dialog, scrolls instead, by most of a screen. */
function scrollPage(direction: Direction): void {
  const box = scroller(scrollFrom())
  const height = box instanceof Window ? box.innerHeight : box.clientHeight
  box.scrollBy({ top: (direction === 'down' ? 0.8 : -0.8) * height, behavior: 'smooth' })
}

function move(direction: Direction): void {
  if (guideHasFocus()) return toGuide(direction)
  if (key(`Arrow${direction[0]!.toUpperCase()}${direction.slice(1)}`)) return
  const root = scope()
  // A menu or a sheet is a list: one way along it, in the order a keyboard goes. The page is laid out in two dimensions.
  if (root !== document) return step(focusables(root), direction === 'down' || direction === 'right' ? 1 : -1)
  if (!moveSpatial(direction, root) && (direction === 'up' || direction === 'down')) scrollPage(direction)
}

function press(button: Button): void {
  if (button !== 'a' && button !== 'menu' && guideHasFocus()) return toGuide(button)
  switch (button) {
    case 'a': {
      const el = document.activeElement as HTMLElement | null
      if (el && el !== document.body && el.matches(FOCUSABLE)) el.click()
      else enter(scope())
      break
    }
    case 'b': {
      const open = scope() !== document
      const field = (document.activeElement as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')
      // Escape first: a sheet, a menu or a field takes it. With none open, B is the page's own back: to the page before, inside Renplay.
      if (!key('Escape') && !open && !field && window.history.state?.idx > 0) window.dispatchEvent(new Event('renplay:pad-back'))
      break
    }
    case 'menu':
      window.dispatchEvent(new Event('renplay:pad-menu'))
      break
    case 'lb':
    case 'rb':
      // The pages are the page's: not from inside a sheet or a menu.
      if (scope() === document) window.dispatchEvent(new CustomEvent('renplay:pad-page', { detail: button === 'lb' ? -1 : 1 }))
      break
  }
}

/** How fast the right stick scrolls at its full push, in pixels a second. */
const SCROLL_SPEED = 1400

/** The right stick scrolls what has focus, or the page, as far as it is pushed. */
function scrollBy(push: { x: number; y: number }, ms: number): void {
  if (!push.x && !push.y) return
  const k = (SCROLL_SPEED * Math.min(ms, 50)) / 1000
  const box = scroller(scrollFrom())
  box.scrollBy({ top: push.y * k, left: push.x * k, behavior: 'instant' })
}

/** Menu held this long, with the guide holding the controller, parks the guide instead of opening the menu. */
const HOLD = 500

let running = false
let gameHasPad = false
let menuHeld = { guide: false, parked: false }

/** While a game plays and its drawer is closed, the game has the controller, wherever focus is. */
export function setGameHasPad(on: boolean): void {
  gameHasPad = on
}

/** Whether the controller is what the person is using now: it moves with the first press and ends with the first touch, key or pointer move. */
let inUse = false
const listeners = new Set<() => void>()
const useIs = (on: boolean) => {
  if (inUse === on) return
  inUse = on
  for (const listener of listeners) listener()
}

/** Starts listening once a controller connects. Call once. */
export function installGamepad(): void {
  if (!('getGamepads' in navigator)) return
  const since = new Map<Button, number>()
  const directions = directionRepeater(move)
  let last = 0
  const tick = (now: number) => {
    if (!connected()) {
      running = false
      useIs(false)
      return
    }
    const { buttons: held, direction, scroll } = read()
    const ms = now - last
    last = now
    // A game in a frame with focus has the controller. Buttons it was given count as held here, so
    // the press that opened the drawer does not reach the drawer as a new one.
    if (gameHasPad || document.activeElement?.tagName === 'IFRAME') {
      for (const input of held) if (!since.has(input)) since.set(input, now)
      menuHeld = { guide: false, parked: false }
      for (const input of [...since.keys()]) if (!held.has(input)) since.delete(input)
      directions.absorb(direction, now)
      requestAnimationFrame(tick)
      return
    }
    if (held.size || direction || scroll.x || scroll.y) useIs(true)
    // Menu: a press opens the menu or closes it. With the guide holding the controller a press waits to see whether it is held.
    const menu = held.has('menu')
    if (menu && !since.has('menu')) {
      since.set('menu', now)
      menuHeld = { guide: guideHasFocus(), parked: false }
      if (!menuHeld.guide) press('menu')
    } else if (menu && menuHeld.guide && !menuHeld.parked && now - since.get('menu')! >= HOLD) {
      menuHeld.parked = true
      toGuide('b')
    } else if (!menu && since.has('menu')) {
      if (menuHeld.guide && !menuHeld.parked) press('menu')
      since.delete('menu')
    }
    held.delete('menu')
    for (const input of held) {
      if (since.has(input)) continue
      since.set(input, now)
      press(input)
    }
    for (const input of [...since.keys()]) if (input !== 'menu' && !held.has(input)) since.delete(input)
    directions.step(direction, now)
    if (!guideHasFocus()) scrollBy(scroll, ms)
    requestAnimationFrame(tick)
  }
  const start = () => {
    if (running) return
    running = true
    last = performance.now()
    requestAnimationFrame(tick)
  }
  window.addEventListener('gamepadconnected', start)
  // Their own hands on something else: the controller is not what is being used. A key or a pointer the page made itself (the controller's arrows) is not.
  // The browser repeats the pointer's last place after a scroll, with no movement in it: that is not a hand.
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const)
    window.addEventListener(type, (e) => e.isTrusted && !(e instanceof MouseEvent && e.type === 'pointermove' && !e.movementX && !e.movementY) && useIs(false), { passive: true, capture: true })
  if (connected()) start()
}

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
    connected,
  )
}

/** Whether the controller is in use now: pressed last, and no keyboard, pointer or touch since. The library's legend shows only then. */
export function useGamepadInUse(): boolean {
  return useSyncExternalStore(
    (on) => {
      listeners.add(on)
      return () => listeners.delete(on)
    },
    () => inUse,
  )
}
