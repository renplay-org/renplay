import { useEffect, useState } from 'react'

/**
 * Keyboard Lock (Chromium): in fullscreen, a tap of Esc reaches the game
 * (Ren'Py's menu) and holding Esc leaves fullscreen. Elsewhere the browser
 * keeps Esc for leaving fullscreen.
 */
type KeyboardLock = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void; getLayoutMap?: () => Promise<Map<string, string>> }
export const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard

/**
 * What the menu key and the guide key look like on this keyboard: the layout's own character where the
 * browser tells it, a backquote and a backslash otherwise. The keys themselves are physical, so a layout
 * only changes what is printed on them.
 */
export function useKeyLabels(): { menu: string; guide: string } {
  const [labels, setLabels] = useState({ menu: '`', guide: '\\' })
  useEffect(() => {
    let stopped = false
    keyboard()?.getLayoutMap?.().then(
      (map) => {
        if (!stopped) setLabels({ menu: map.get('Backquote') || '`', guide: map.get('Backslash') || '\\' })
      },
      () => {},
    )
    return () => {
      stopped = true
    }
  }, [])
  return labels
}
