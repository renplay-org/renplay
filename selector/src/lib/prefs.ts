import { useSyncExternalStore } from 'react'

/** Preferences of this browser (not synced: a phone used in public can differ from the TV). */
const BLUR_ADULT = 'renplay:blur-adult-covers'
const EVENT = 'renplay:prefs'

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(EVENT, cb)
  }
}

/** Blur the covers of adult games, for screens other people can see. */
export function useBlurAdultCovers(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => localStorage.getItem(BLUR_ADULT) === '1')
  const set = (v: boolean) => {
    if (v) localStorage.setItem(BLUR_ADULT, '1')
    else localStorage.removeItem(BLUR_ADULT)
    window.dispatchEvent(new Event(EVENT))
  }
  return [on, set]
}
