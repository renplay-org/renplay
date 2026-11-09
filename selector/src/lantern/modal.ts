import { useEffect, useRef, type RefObject } from 'react'

/** The controls that can take focus, in the order Tab visits them. */
export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The open layers (sheets, the player's drawer), topmost last. Only the topmost answers Escape and traps Tab. */
const stack: Array<{ close: () => void; inert: boolean }> = []

/**
 * A modal layer: opening moves focus inside, Tab stays inside, Escape closes it, and closing gives
 * focus back to what opened it. With `inert` the page (#root) takes no input while it is open, its own
 * keys included, so the layer itself must be outside it, in a portal. Without `onClose`, Escape leaves
 * it open.
 */
export function useModal(ref: RefObject<HTMLElement | null>, open: boolean, onClose: (() => void) | null, { initial, inert = false }: { initial?: string; inert?: boolean } = {}): void {
  const closing = useRef(onClose)
  closing.current = onClose
  useEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    const opener = document.activeElement
    const layer = { close: () => closing.current?.(), inert }
    stack.push(layer)
    const root = document.getElementById('root')
    const settle = () => {
      if (root) root.inert = stack.some((l) => l.inert)
    }
    settle()
    const first = (initial ? el.querySelector<HTMLElement>(initial) : null) ?? el.querySelector<HTMLElement>('[data-initial]') ?? el.querySelector<HTMLElement>('.sheet-close') ?? el.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? el).focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== layer) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (inert) e.stopPropagation()
        layer.close()
        return
      }
      if (e.key !== 'Tab') return
      const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement)
      if (!f.length) return
      // Focus that slipped out of the layer (a control that went away) comes back in.
      if (!el.contains(document.activeElement)) {
        e.preventDefault()
        ;(e.shiftKey ? f[f.length - 1]! : f[0]!).focus()
        return
      }
      const i = f.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && i <= 0) {
        e.preventDefault()
        f[f.length - 1]!.focus()
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault()
        f[0]!.focus()
      }
    }
    // On the document, so Escape and Tab still work when focus has slipped out of the layer.
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const i = stack.indexOf(layer)
      if (i >= 0) stack.splice(i, 1)
      settle()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open, initial, inert, ref])
}
