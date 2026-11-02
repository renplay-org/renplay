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
  const ua = navigator.userAgent
  const isMac = /Macintosh|Mac OS X/.test(ua) && navigator.maxTouchPoints <= 1
  if (!isMac || window.devicePixelRatio < 2) return 0
  const w = screen.width
  const h = screen.height
  const aspect = w / h
  if (aspect < 1.52 || aspect > 1.56) return 0
  const notch = Math.round(h - w / 1.6)
  return notch >= 24 && notch <= 48 ? notch : 0
}

/**
 * In fullscreen, browsers either draw under the notch (viewport as tall as
 * the screen) or keep that strip black themselves. Only in the first case can
 * the page choose to avoid it.
 */
export function fullscreenCoversNotch(): boolean {
  return Math.abs(window.innerHeight - screen.height) <= 2
}

/** Size and offset of the game frame for a given container and mode. */
export function frameRect(
  cw: number,
  ch: number,
  screenSize: [number, number] | null,
  mode: FitMode,
): { width: number; height: number; left: number; top: number } {
  if (mode !== 'fill' || !screenSize || !cw || !ch) return { width: cw, height: ch, left: 0, top: 0 }
  const ar = screenSize[0] / screenSize[1]
  const width = Math.max(cw, ch * ar)
  const height = Math.max(ch, cw / ar)
  return { width, height, left: (cw - width) / 2, top: (ch - height) / 2 }
}
