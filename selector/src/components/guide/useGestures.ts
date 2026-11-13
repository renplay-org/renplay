import { useEffect, useRef, type RefObject } from 'react'

/** Where a gesture is, in the scrolling element's own space: the point that stays under the fingers. */
export interface Focal {
  x: number
  y: number
}

/**
 * Zoom by pinch, by Ctrl with the wheel (a trackpad's pinch comes the same way) and a double tap or double
 * click. During a pinch the content is only scaled by CSS, which is cheap, and the new zoom is applied when the
 * fingers lift. `scale` reads the zoom now, `zoomBy` and `toggle` apply a change, and `content` is what is scaled.
 * `on` is while the pages are there to be zoomed: the scrolling element does not exist before.
 */
export function useGestures(view: RefObject<HTMLElement | null>, content: RefObject<HTMLElement | null>, scale: () => number, zoomBy: (factor: number, at: Focal) => void, toggle: (at: Focal) => void, on: boolean) {
  const latest = useRef({ scale, zoomBy, toggle })
  latest.current = { scale, zoomBy, toggle }
  useEffect(() => {
    const el = view.current
    if (!el || !on) return
    const at = (x: number, y: number): Focal => {
      const r = el.getBoundingClientRect()
      return { x: x - r.left, y: y - r.top }
    }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      latest.current.zoomBy(Math.exp(-Math.max(-30, Math.min(30, e.deltaY)) * 0.01), at(e.clientX, e.clientY))
    }
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch: { start: number; focal: Focal; ratio: number } | null = null
    let tap: { time: number; x: number; y: number } | null = null
    let moved = false
    const distance = () => {
      const [a, b] = [...pointers.values()]
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
    }
    const middle = (): Focal => {
      const [a, b] = [...pointers.values()]
      return at(((a?.x ?? 0) + (b?.x ?? 0)) / 2, ((a?.y ?? 0) + (b?.y ?? 0)) / 2)
    }
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 1) moved = false
      if (pointers.size === 2) {
        pinch = { start: distance(), focal: middle(), ratio: 1 }
        tap = null
        moved = true
        if (content.current) content.current.style.transformOrigin = `${el.scrollLeft + pinch.focal.x}px ${el.scrollTop + pinch.focal.y}px`
      }
    }
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 && pointers.size === 1) moved = true
      if (pointers.size === 1) return
      p.x = e.clientX
      p.y = e.clientY
      if (!pinch || !pinch.start) return
      const target = Math.max(0.25, Math.min(5, latest.current.scale() * (distance() / pinch.start))) / latest.current.scale()
      pinch.ratio = target
      if (content.current) content.current.style.transform = `scale(${target})`
    }
    const up = (e: PointerEvent) => {
      const was = pointers.size
      const p = pointers.get(e.pointerId)
      pointers.delete(e.pointerId)
      if (pinch && was === 2) {
        const done = pinch
        pinch = null
        if (content.current) {
          content.current.style.transform = ''
          content.current.style.transformOrigin = ''
        }
        if (done.ratio !== 1) latest.current.zoomBy(done.ratio, done.focal)
        return
      }
      if (was !== 1 || !p || moved || e.type === 'pointercancel') return
      const now = e.timeStamp
      if (tap && now - tap.time < 350 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 30) {
        tap = null
        latest.current.toggle(at(e.clientX, e.clientY))
      } else tap = { time: now, x: e.clientX, y: e.clientY }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [view, content, on])
}
