import { Loader2, Check, AlertTriangle, Info } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import Sheet from '../lantern/Sheet'
import { Pill, IconBtn, TagPill, LanternSwitch } from '../lantern/controls'

/** Form fields on plates: 46 px, radius 14. */
export const accountInput = 'input'

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass'
type Size = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  href,
  to,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode; href?: string; to?: string; target?: string; rel?: string }) {
  const v = variant === 'primary' ? 'p' : variant === 'ghost' ? 'q' : variant === 'danger' ? 'd' : 's'
  return (
    <Pill
      variant={v}
      size={size === 'md' ? undefined : size}
      icon={loading ? <Loader2 className="animate-spin" /> : icon}
      className={cx(variant === 'glass' && 'glass', className)}
      disabled={disabled || loading}
      href={href}
      to={to}
      {...rest}
    >
      {children}
    </Pill>
  )
}

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <IconBtn label={label} className={cx(active && 'on', className)} style={active ? { background: 'var(--plate-2)', color: 'var(--fg)' } : undefined} {...rest}>
      {children}
    </IconBtn>
  )
}

/** Small label pill. */
export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'green' | 'amber' | 'red' | 'violet'; children: ReactNode; className?: string }) {
  const t = className?.includes('glass') ? 'dark' : tone === 'accent' ? 'pink' : tone === 'violet' ? 'vio' : tone === 'neutral' ? undefined : tone
  return (
    <span className={className?.replace('glass', '').trim() || undefined}>
      <TagPill tone={t as 'pink'}>{children}</TagPill>
    </span>
  )
}

/** Games of engines other than Ren'Py play as a beta: they work, with fewer features (docs.renplay.org/engines). */
export function BetaBadge({ engine }: { engine?: string | null }) {
  if (!engine || engine === 'renpy') return null
  return (
    <span className="inline-flex shrink-0" title="Renplay plays games of engines other than Ren’Py as a beta: they work, with fewer features.">
      <TagPill tone="vio">Beta</TagPill>
    </span>
  )
}

export function Progress({ value, className, indeterminate }: { value: number; className?: string; indeterminate?: boolean }) {
  if (indeterminate)
    return (
      <div className={cx('bar', className)}>
        <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} />
      </div>
    )
  return (
    <div className={cx('bar', className)}>
      <i style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className)} style={{ width: 20, height: 20, color: 'var(--fg-3)' }} />
}

/** An empty state: a plate, never a ring. */
export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-filter">
      {icon && <div className="muted" style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>{icon}</div>}
      <div className="h3">{title}</div>
      {children && <div className="small muted" style={{ maxWidth: 460, margin: '6px auto 0' }}>{children}</div>}
      {action && <div className="actions" style={{ justifyContent: 'center', marginTop: 16 }}>{action}</div>}
    </div>
  )
}

export function Modal(props: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean | 'xl'
  fullPhone?: boolean
}) {
  return <Sheet {...props} />
}

export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirm',
  danger,
  busy,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  children?: ReactNode
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="small muted-2" style={{ lineHeight: 1.6, fontSize: 14 }}>{children}</div>
    </Modal>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: ReactNode }> }) {
  return (
    <div className="seg" role="group">
      {tabs.map((t) => (
        <button key={t.id} type="button" aria-pressed={value === t.id} onClick={() => onChange(t.id)} className={value === t.id ? 'on' : ''}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <div className="setting inline">
      <div className="l">
        <div className="t">{label}</div>
        {hint && <div className="d">{hint}</div>}
      </div>
      <div className="c">
        <LanternSwitch checked={checked} onChange={onChange} label={typeof label === 'string' ? label : 'Switch'} />
      </div>
    </div>
  )
}

/** Small popover menu anchored to its trigger. */
export function Menu({ trigger, children, align = 'right' }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const anchor = useRef<DOMRect | null>(null)
  // Once the menu is drawn, its real size places it: below the button, or above it when the
  // screen has no room below, and always inside the screen.
  const place = useCallback(() => {
    const box = ref.current?.getBoundingClientRect() ?? anchor.current
    const menu = menuRef.current
    if (!box || !menu) return
    const h = menu.offsetHeight
    const w = menu.offsetWidth
    const below = box.bottom + 8
    const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, box.top - 8 - h)
    const left = Math.max(8, Math.min(align === 'right' ? box.right - w : box.left, window.innerWidth - w - 8))
    setPosition({ top, left })
  }, [align])
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    // Scrolling the page (a smooth or momentum scroll still running after the tap, too) moves the
    // menu with its button. It closes only once the button has left the screen.
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return
      const box = ref.current?.getBoundingClientRect()
      if (!box || box.bottom < 0 || box.top > window.innerHeight) setOpen(false)
      else place()
    }
    const onResize = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, place])
  return (
    <div ref={ref} className="relative" style={{ display: 'inline-flex' }}>
      {trigger(() => {
        anchor.current = ref.current?.getBoundingClientRect() ?? null
        setOpen((value) => !value)
      })}
      {open &&
        createPortal(
          <div ref={menuRef} role="group" aria-label="Actions" data-actions-menu style={position} className="pop menu-pop">
            <div className="menu">{children(() => setOpen(false))}</div>
          </div>,
          document.body,
        )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger, disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={danger ? 'd' : ''} style={disabled ? { opacity: 0.4 } : undefined}>
      {icon}
      {children}
    </button>
  )
}

// ---- toasts ------------------------------------------------------------------

type ToastTone = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  tone: ToastTone
  text: ReactNode
}
const ToastCtx = createContext<(text: ReactNode, tone?: ToastTone) => void>(() => {})

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: ReactNode, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random()
    setItems((v) => [...v.slice(-3), { id, tone, text }])
    setTimeout(() => setItems((v) => v.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <>
          {items.map((t) => (
            <div key={t.id} className="toast" role="status">
              {t.tone === 'success' ? (
                <Check style={{ color: 'var(--green)' }} />
              ) : t.tone === 'error' ? (
                <AlertTriangle style={{ color: 'var(--red)' }} />
              ) : (
                <Info style={{ color: 'var(--violet-2)' }} />
              )}
              <span>{t.text}</span>
            </div>
          ))}
        </>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
