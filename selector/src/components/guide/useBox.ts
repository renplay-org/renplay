import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { keep, keptBox, type Box } from './keep'

type Insets = { top: number; right: number; bottom: number; left: number }

const MIN_W = 260
const MIN_H = 200

/**
 * The floating window's place and size. The first time it is as wide as the guide needs (42 percent of the
 * screen, at least 520 px) and 82 percent of its height, at the right, or just to the right of the menu's sheet
 * (`after`) when it opens beside it. After that it is where the person left it, inside the screen.
 */
export function useBox(insets: Insets, after: number | undefined) {
  const bounds = () => ({ left: insets.left + 8, top: insets.top + 8, right: window.innerWidth - insets.right - 8, bottom: window.innerHeight - insets.bottom - 8 })
  const clamp = (n: Box): Box => {
    const b = bounds()
    const w = Math.max(MIN_W, Math.min(n.w, b.right - b.left))
    const h = Math.max(MIN_H, Math.min(n.h, b.bottom - b.top))
    return { w, h, x: Math.min(Math.max(n.x, b.left), b.right - w), y: Math.min(Math.max(n.y, b.top), b.bottom - h) }
  }
  const [box, setBox] = useState<Box>(() => {
    const b = bounds()
    const last = keptBox()
    // Where the person left it, and never under the menu's sheet when it opens beside it.
    if (last) return clamp({ ...last, x: after !== undefined ? Math.max(last.x, after + 12) : last.x })
    const h = (b.bottom - b.top) * 0.82
    const wide = Math.max(520, window.innerWidth * 0.42)
    if (after !== undefined) {
      const x = after + 12
      return clamp({ x, y: b.top + 48, w: Math.min(wide, b.right - x), h })
    }
    return clamp({ x: b.right - wide, y: b.top + 48, w: wide, h })
  })
  useEffect(() => {
    const fit = () => setBox((b) => clamp(b))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets.top, insets.right, insets.bottom, insets.left])
  const drag = (mode: 'move' | 'size') => (e: ReactPointerEvent) => {
    if (mode === 'move' && (e.target as HTMLElement).closest('button, a, input, select')) return
    e.preventDefault()
    const start = { px: e.clientX, py: e.clientY, ...box }
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px
      const dy = ev.clientY - start.py
      setBox(clamp(mode === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy }))
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      setBox((b) => {
        keep({ box: b })
        return b
      })
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }
  return { box, drag }
}
