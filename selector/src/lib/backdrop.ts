import { useSyncExternalStore } from 'react'

/*
 * Lighter background: a plain backdrop instead of the game's art behind each screen. Until the
 * person chooses on this device, it follows reduced motion and the browser's data saver.
 */
const KEY = 'renplay:lighter-background'
const EVENT = 'renplay:lighter-background'
const REDUCED = '(prefers-reduced-motion: reduce)'

function followsDevice(): boolean {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia(REDUCED).matches
  const saveData = !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
  return reduced || saveData
}

function choice(): boolean | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

export function setLighterBackground(on: boolean): void {
  try {
    // Choosing what the device would do anyway goes back to following it.
    if (on === followsDevice()) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, on ? '1' : '0')
  } catch {}
  dispatchEvent(new Event(EVENT))
}

function subscribe(onChange: () => void): () => void {
  const mq = typeof matchMedia !== 'undefined' ? matchMedia(REDUCED) : null
  addEventListener(EVENT, onChange)
  addEventListener('storage', onChange)
  mq?.addEventListener('change', onChange)
  return () => {
    removeEventListener(EVENT, onChange)
    removeEventListener('storage', onChange)
    mq?.removeEventListener('change', onChange)
  }
}

const snapshot = () => {
  const c = choice()
  return `${c ?? followsDevice()}|${c === null ? 'device' : 'chosen'}`
}

/** Whether the background is lighter here, and whether this device chose it. */
export function useLighterBackground(): { on: boolean; chosen: boolean } {
  const [on, from] = useSyncExternalStore(subscribe, snapshot).split('|')
  return { on: on === 'true', chosen: from === 'chosen' }
}
