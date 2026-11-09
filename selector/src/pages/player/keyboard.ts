/**
 * Keyboard Lock (Chromium): in fullscreen, a tap of Esc reaches the game
 * (Ren'Py's menu) and holding Esc leaves fullscreen. Elsewhere the browser
 * keeps Esc for leaving fullscreen.
 */
type KeyboardLock = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void }
export const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
export const canLockEscape = () => typeof keyboard()?.lock === 'function'
