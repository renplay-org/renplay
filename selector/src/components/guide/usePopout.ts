import { useCallback, useEffect, useState } from 'react'
import { openPopup } from '../../lib/links'

/** Chromium's Document Picture-in-Picture: a small window that stays on top of everything, with a page of its own. */
interface DocumentPictureInPicture {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>
}
const pictureInPicture = () => (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture

/** The app's styles, copied into the small window: linked ones by address, inline ones as they are. */
function copyStyles(from: Document, to: Document) {
  to.documentElement.className = from.documentElement.className
  to.body.className = from.body.className
  for (const el of from.querySelectorAll('link[rel="stylesheet"], style')) to.head.appendChild(el.cloneNode(true))
}

export type Popout = { kind: 'window'; win: Window } | { kind: 'popup'; win: Window }

/**
 * The guide out of the page. On Chromium a Picture-in-Picture window, which the reader is moved to; elsewhere
 * a popup window on the small page `/guide/<game>/<file>`. Either way the person closing the window brings the
 * guide back. `out` is the window while the guide is out of the page.
 */
export function usePopout(path: string, size: () => { w: number; h: number }) {
  const [out, setOut] = useState<Popout | null>(null)
  const open = useCallback(async () => {
    const { w, h } = size()
    const pip = pictureInPicture()
    if (pip) {
      try {
        const win = await pip.requestWindow({ width: Math.round(w), height: Math.round(h) })
        copyStyles(document, win.document)
        win.document.body.classList.add('gw-popped')
        setOut({ kind: 'window', win })
        return true
      } catch {
        // Refused (no recent tap, or the browser's setting): a popup window instead.
      }
    }
    const win = openPopup(path, { w, h })
    if (!win) return false
    setOut({ kind: 'popup', win })
    return true
  }, [path, size])
  const win = out?.win
  const kind = out?.kind
  useEffect(() => {
    if (!win) return
    const back = () => setOut(null)
    // A popup window cannot be told when it closes (it navigates, and that unloads its first page): the page asks.
    if (kind === 'window') win.addEventListener('pagehide', back)
    const watch = setInterval(() => win.closed && back(), 500)
    return () => {
      win.removeEventListener('pagehide', back)
      clearInterval(watch)
      win.close()
    }
  }, [win, kind])
  return { out, open, bringBack: () => setOut(null) }
}
