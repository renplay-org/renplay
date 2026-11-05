import { useSyncExternalStore } from 'react'
import { useAuth } from './auth'

export type AdultPictures = 'show' | 'hide-pictures' | 'hide-games'
const EVENT = 'renplay:prefs'
function subscribe(cb: () => void) {
  window.addEventListener('storage', cb); window.addEventListener(EVENT, cb)
  return () => { window.removeEventListener('storage', cb); window.removeEventListener(EVENT, cb) }
}
export function useAdultPictures(): [AdultPictures, (mode: AdultPictures | '') => void, boolean] {
  const { data } = useAuth()
  const key = `renplay:adult-pictures:${data?.user.id ?? ''}`
  const override = useSyncExternalStore(subscribe, () => localStorage.getItem(key))
  let account: AdultPictures = 'hide-pictures'
  try { account = JSON.parse(data?.user.prefs || '{}').adultPictures || account } catch { /* Default hides pictures. */ }
  const set = (mode: AdultPictures | '') => {
    if (mode) localStorage.setItem(key, mode)
    else localStorage.removeItem(key)
    window.dispatchEvent(new Event(EVENT))
  }
  return [(override || account) as AdultPictures, set, !!override]
}
/** Device choices can narrow, never grant, the server's adult access. */
export function useBlurAdultCovers(): [boolean, (on: boolean) => void] {
  const [mode, set] = useAdultPictures()
  return [mode !== 'show', (on) => set(on ? 'hide-pictures' : 'show')]
}
