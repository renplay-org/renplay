import { useSyncExternalStore } from 'react'
import { useAuth } from './auth'

export type AdultPictures = 'show' | 'hide-pictures' | 'hide-games'
export const adultPictureModes: AdultPictures[] = ['show', 'hide-pictures', 'hide-games']
export function accountAdultPictures(prefs?: string): AdultPictures {
  try {
    const mode = JSON.parse(prefs || '{}').adultPictures
    if (adultPictureModes.includes(mode)) return mode
  } catch { /* Default hides pictures. */ }
  return 'hide-pictures'
}
const EVENT = 'renplay:prefs'
function subscribe(cb: () => void) {
  window.addEventListener('storage', cb); window.addEventListener(EVENT, cb)
  return () => { window.removeEventListener('storage', cb); window.removeEventListener(EVENT, cb) }
}
export function useAdultPictures(): [AdultPictures, (mode: AdultPictures | '') => void, boolean] {
  const { data } = useAuth()
  const key = `renplay:adult-pictures:${data?.user.id ?? ''}`
  const override = useSyncExternalStore(subscribe, () => localStorage.getItem(key))
  const account = accountAdultPictures(data?.user.prefs)
  const device = adultPictureModes.includes(override as AdultPictures) ? override as AdultPictures : account
  const effective = adultPictureModes[Math.max(adultPictureModes.indexOf(account), adultPictureModes.indexOf(device))]!
  const set = (mode: AdultPictures | '') => {
    if (mode) localStorage.setItem(key, mode)
    else localStorage.removeItem(key)
    window.dispatchEvent(new Event(EVENT))
  }
  return [effective, set, !!override]
}
/** Device choices can only narrow the account's visibility and picture preferences. */
export function useBlurAdultCovers(): [boolean, (on: boolean) => void] {
  const [mode, set] = useAdultPictures()
  return [mode !== 'show', (on) => set(on ? 'hide-pictures' : 'show')]
}
