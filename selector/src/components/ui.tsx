import { X, Loader2, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-accent-500 to-accent-600 text-white shadow-[0_8px_24px_-8px_rgb(244_80_138/0.6)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-white/[0.07] text-zinc-100 ring-1 ring-inset ring-white/10 hover:bg-white/[0.11]',
  ghost: 'text-zinc-300 hover:bg-white/[0.06] hover:text-white',
  danger: 'bg-red-500/10 text-red-300 ring-1 ring-inset ring-red-500/25 hover:bg-red-500/20',
  glass: 'glass text-white ring-1 ring-inset ring-white/15 hover:bg-white/15',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-2xl',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/70 disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
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
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-9 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400/70 disabled:opacity-40',
        active && 'bg-white/10 text-white',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'green' | 'amber' | 'red' | 'violet'; children: ReactNode; className?: string }) {
  const tones = {
    neutral: 'bg-white/[0.07] text-zinc-300 ring-white/10',
    accent: 'bg-accent-500/15 text-accent-300 ring-accent-500/25',
    green: 'bg-emerald-500/12 text-emerald-300 ring-emerald-500/25',
    amber: 'bg-amber-500/12 text-amber-300 ring-amber-500/25',
    red: 'bg-red-500/12 text-red-300 ring-red-500/25',
    violet: 'bg-violet-500/12 text-violet-300 ring-violet-500/25',
  }
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  )
}

/** Games of engines other than Ren'Py play as a beta: they work, with fewer features (docs/engines.md). */
export function BetaBadge({ engine }: { engine?: string | null }) {
  if (!engine || engine === 'renpy') return null
  return (
    <span className="inline-flex shrink-0" title="Renplay plays games of engines other than Ren’Py as a beta: they work, with fewer features.">
      <Badge tone="violet">Beta</Badge>
    </span>
  )
}

export function Progress({ value, className, indeterminate }: { value: number; className?: string; indeterminate?: boolean }) {
  return (
    <div className={cx('h-1.5 overflow-hidden rounded-full bg-white/10', className)}>
      <div
        className={cx(
          'h-full rounded-full bg-gradient-to-r from-accent-500 to-violet-400 transition-[width] duration-500',
          indeterminate && 'skeleton w-full',
        )}
        style={indeterminate ? undefined : { width: `${Math.max(2, Math.min(100, value * 100))}%` }}
      />
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-zinc-400', className)} />
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 px-6 py-16 text-center">
      {icon && <div className="mb-4 text-zinc-500">{icon}</div>}
      <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
      {children && <div className="mt-1.5 max-w-md text-sm text-zinc-400">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
  fullPhone,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean | 'xl'
  fullPhone?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative flex max-h-[92vh] w-full animate-rise flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-ink-850 shadow-2xl sm:rounded-3xl',
          wide === 'xl' ? 'sm:max-w-6xl' : wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
          fullPhone && 'max-sm:h-dvh max-sm:max-h-dvh max-sm:rounded-none',
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
            <h2 className="truncate text-[15px] font-semibold text-white">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <X className="size-4" />
            </IconButton>
          </div>
        )}
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
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
      <div className="text-sm leading-relaxed text-zinc-300">{children}</div>
    </Modal>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: ReactNode }> }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-2xl bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.06]">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-all',
            value === t.id ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span>
        <span className="block text-sm text-zinc-100">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors', checked ? 'bg-accent-500' : 'bg-white/15')}
      >
        <span className={cx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  )
}

/** Small popover menu anchored to its trigger. */
export function Menu({ trigger, children, align = 'right' }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onScroll = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setOpen(false) }
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
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger(() => {
        const box = ref.current?.getBoundingClientRect()
        if (box) setPosition({
          top: Math.min(box.bottom + 8, Math.max(8, window.innerHeight - 320)),
          left: Math.max(8, Math.min(align === 'right' ? box.right - 240 : box.left, window.innerWidth - 248)),
        })
        setOpen((value) => !value)
      })}
      {open && createPortal(
        <div ref={menuRef} role="group" aria-label="Actions" data-actions-menu style={position} className="fixed z-[100] max-h-[calc(100dvh-16px)] w-60 animate-rise overflow-y-auto rounded-2xl border border-white/10 bg-ink-800/95 p-1.5 shadow-2xl backdrop-blur-xl">
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger, disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-40',
        danger ? 'text-red-300 hover:bg-red-500/15' : 'text-zinc-200 hover:bg-white/[0.08]',
      )}
    >
      {icon && <span className="text-zinc-400 [&>svg]:size-4">{icon}</span>}
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
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[200] flex flex-col items-center gap-2 px-4">
          {items.map((t) => (
            <div key={t.id} className="pointer-events-auto flex max-w-md animate-rise items-start gap-3 rounded-2xl border border-white/10 bg-ink-800/95 px-4 py-3 text-sm text-zinc-100 shadow-2xl backdrop-blur-xl">
              {t.tone === 'success' ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
              ) : t.tone === 'error' ? (
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0 text-violet-300" />
              )}
              <div>{t.text}</div>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
