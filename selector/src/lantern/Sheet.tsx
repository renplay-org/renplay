import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** The open sheets, topmost last. Only the topmost answers Escape and traps Tab. */
const stack: Array<{ el: HTMLElement; opener: Element | null; onClose: () => void }> = []

function rootEl(): HTMLElement | null {
  return document.getElementById('root')
}

/**
 * A sheet is a modal dialog: opening moves focus inside, Tab stays inside,
 * Escape closes it, closing returns focus to what opened it, and the page
 * behind is inert. Bottom sheet on phones, a bounded glass window on desktop.
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  fullPhone,
  initial,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean | 'xl'
  fullPhone?: boolean
  /** Selector of the control to focus first. */
  initial?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closing = useRef(onClose)
  closing.current = onClose

  useEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    const opener = document.activeElement
    const rec = { el, opener, onClose: () => closing.current() }
    stack.push(rec)
    const root = rootEl()
    if (root) root.inert = true
    const first = (initial ? el.querySelector<HTMLElement>(initial) : null) ?? el.querySelector<HTMLElement>('[data-initial]') ?? el.querySelector<HTMLElement>('.sheet-close') ?? el.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? el).focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== rec) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closing.current()
        return
      }
      if (e.key !== 'Tab') return
      const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement)
      if (!f.length) return
      // Focus that slipped out of the sheet (a control that went away) comes back in.
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
    // On the document, so Escape and Tab still work when focus has slipped out of the sheet.
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const idx = stack.indexOf(rec)
      if (idx >= 0) stack.splice(idx, 1)
      if (!stack.length && root) root.inert = false
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open, initial])

  if (!open) return null
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={`sheet ${wide === 'xl' ? 'xwide' : wide ? 'wide' : ''} ${fullPhone ? 'full-ph' : ''}`.replace(/\s+/g, ' ').trim()}
      >
        <div className="grip" aria-hidden="true" />
        {title && (
          <div className="sheet-h">
            <h2 className="h2">{title}</h2>
            <button type="button" className="ib sheet-close" aria-label="Close" onClick={onClose}>
              <X />
            </button>
          </div>
        )}
        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </>,
    document.body,
  )
}
