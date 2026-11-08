import { isAppleTouch, isMacComputer, isStandalone } from './platform'
export type FitMode = 'fit' | 'fill'

export interface DisplayPrefs {
  fit: FitMode
  avoidNotch: boolean
}

const KEY = 'renplay:display'

export function loadPrefs(): DisplayPrefs {
  try {
    return { fit: 'fit', avoidNotch: true, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { fit: 'fit', avoidNotch: true }
  }
}

export function savePrefs(p: DisplayPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {}
}

/**
 * Notched MacBooks (2021+) have panels slightly taller than 16:10; the area
 * below the camera housing is exactly 16:10. Returns the notch height in CSS
 * pixels, or 0 when this does not look like such a display.
 */
export function notchHeight(): number {
  if (!isMacComputer() || window.devicePixelRatio < 2) return 0
  const w = screen.width
  const h = screen.height
  const aspect = w / h
  if (aspect < 1.52 || aspect > 1.56) return 0
  const notch = Math.round(h - w / 1.6)
  return notch >= 24 && notch <= 48 ? notch : 0
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

/**
 * The device's safe-area insets in CSS pixels: camera cutout (notch, Dynamic
 * Island), rounded corners and the home indicator, for the current
 * orientation. Zero on desktops. Needs viewport-fit=cover.
 */
export function safeInsets(): Insets {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const px = (v: string) => Math.round(parseFloat(v) || 0)
  const out = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) }
  probe.remove()
  return out
}

/**
 * How this device gets a game to fill the screen: the Fullscreen API
 * (desktops, Android, iPad), adding Renplay to the home screen (iPhone, where
 * Safari only lets videos go fullscreen), or nothing to do (already opened
 * from the home screen).
 */
export function fullscreenMode(): 'api' | 'home-screen' | 'none' {
  if (document.fullscreenEnabled) return 'api'
  if (isStandalone()) return 'none'
  return isAppleTouch() ? 'home-screen' : 'none'
}

/**
 * In fullscreen, browsers either draw under the notch (viewport as tall as
 * the screen) or keep that strip black themselves. Only in the first case can
 * the page choose to avoid it.
 */
export function fullscreenCoversNotch(): boolean {
  return Math.abs(window.innerHeight - screen.height) <= 2
}

/**
 * Size and offset of the game frame for a given container and mode, in whole pixels.
 *
 * Fit: the frame has the game's own shape, centred, so Ren'Py fills it edge to edge and the bars
 * are the player's, never a second set drawn inside the game. Fill: on a screen narrower than the
 * game the sides are cropped. It never crops the top or bottom, where games keep their dialogue
 * and buttons: on a wider screen it fits instead.
 */
export function frameRect(
  cw: number,
  ch: number,
  screenSize: [number, number] | null,
  mode: FitMode,
): { width: number; height: number; left: number; top: number } {
  if (!screenSize || !cw || !ch) return { width: cw, height: ch, left: 0, top: 0 }
  const ar = screenSize[0] / screenSize[1]
  if (mode === 'fill' && cw / ch < ar) {
    const width = Math.round(ch * ar)
    return { width, height: ch, left: Math.round((cw - width) / 2), top: 0 }
  }
  const width = Math.min(cw, Math.round(ch * ar))
  const height = Math.min(ch, Math.round(width / ar))
  return { width, height, left: Math.round((cw - width) / 2), top: Math.round((ch - height) / 2) }
}
