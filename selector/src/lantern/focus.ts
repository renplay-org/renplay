import { useEffect } from 'react'
import { reducedMotion } from './travel'

/**
 * One focus engine for touch, mouse and keyboard. Arrow keys move between the
 * tiles of a shelf or a grid the way they do on a console: left and right
 * along the row, up and down to the nearest tile in that direction. Sheets
 * and text fields keep their own keys.
 */
export function useArrowFocus(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
      const target = e.target as HTMLElement | null
      if (target?.closest('.sheet, .pop, [role="dialog"], input, textarea, select, [contenteditable="true"]')) return
      const items = [...document.querySelectorAll<HTMLElement>('[data-focus]')].filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const cur = document.activeElement?.closest<HTMLElement>('[data-focus]') ?? null
      e.preventDefault()
      if (!cur) {
        items[0]!.focus()
        return
      }
      const beh: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth'
      const rowOf = (el: HTMLElement) => el.closest('[data-row]')
      const r = cur.getBoundingClientRect()
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const same = items.filter((el) => rowOf(el) === rowOf(cur))
        const j = same.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1)
        const next = same[j]
        if (next) {
          next.focus()
          next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: beh })
        }
        return
      }
      const dir = e.key === 'ArrowDown' ? 1 : -1
      let best: HTMLElement | null = null
      let bd = Infinity
      for (const el of items) {
        const q = el.getBoundingClientRect()
        if ((q.top - r.top) * dir <= 10) continue
        const d = Math.abs(q.top - r.top) * 2 + Math.abs(q.left - r.left)
        if (d < bd) {
          bd = d
          best = el
        }
      }
      if (best) {
        best.focus()
        best.scrollIntoView({ block: 'center', behavior: beh })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
}
