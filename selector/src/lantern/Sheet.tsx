import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useModal } from './modal'
import { IconBtn } from './controls'

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

  useModal(ref, open, onClose, { initial, inert: true })

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
        {/* Every sheet can be closed with a tap, titled or not: a phone has no other way. */}
        <div className="sheet-h">
          {title && <h2 className="h2">{title}</h2>}
          <IconBtn label="Close" className="sheet-close" onClick={onClose}>
            <X />
          </IconBtn>
        </div>
        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </>,
    document.body,
  )
}
