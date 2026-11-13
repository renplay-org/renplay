import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PDFDocumentProxy, RenderTask } from '../../lib/pdfjs'

/** PDF.js's unit: a point is a 72nd of an inch, and a CSS pixel a 96th. At 100 percent a page is that much larger. */
export const CSS_UNITS = 96 / 72

/** The most pixels one canvas gets: a phone's browser refuses a bigger one. */
const MAX_PIXELS = 16_000_000

/**
 * One page, drawn to a canvas at the screen's pixel ratio once it is near the window, and cleared again when it
 * is far away, so a long guide holds only the pages around the one being read. A new zoom keeps the old picture,
 * stretched, until the new one is ready.
 */
export default function PdfPage({ pdf, index, width, height, scale, root }: { pdf: PDFDocumentProxy; index: number; width: number; height: number; scale: number; root: RefObject<HTMLElement | null> }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el || !root.current) return
    const watch = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), { root: root.current, rootMargin: '150% 0px' })
    watch.observe(el)
    return () => watch.disconnect()
  }, [root])
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    if (!near) {
      target.width = 0
      target.height = 0
      return
    }
    let stopped = false
    let task: RenderTask | undefined
    const later = setTimeout(async () => {
      try {
        const page = await pdf.getPage(index + 1)
        if (stopped) return
        const ratio = Math.min(target.ownerDocument.defaultView?.devicePixelRatio ?? 1, Math.sqrt(MAX_PIXELS / (width * scale * height * scale)))
        const viewport = page.getViewport({ scale: scale * CSS_UNITS * ratio })
        const off = target.ownerDocument.createElement('canvas')
        off.width = Math.ceil(viewport.width)
        off.height = Math.ceil(viewport.height)
        task = page.render({ canvas: off, viewport })
        await task.promise
        if (stopped) return
        target.width = off.width
        target.height = off.height
        target.getContext('2d')?.drawImage(off, 0, 0)
      } catch {
        // A render that was cancelled by the next zoom, or a page that cannot be drawn: it stays blank.
      }
    }, 60)
    return () => {
      stopped = true
      clearTimeout(later)
      task?.cancel()
    }
  }, [near, pdf, index, scale, width, height])
  return (
    <div ref={box} className="gr-page" style={{ width: width * scale, height: height * scale }}>
      <canvas ref={canvas} aria-label={`Page ${index + 1}`} role="img" />
    </div>
  )
}
