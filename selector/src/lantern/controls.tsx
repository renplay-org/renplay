import { Loader2 } from 'lucide-react'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * The pill: the one button shape. Primary is the brand gradient (one lit pill per visible task),
 * plate secondary, quiet text, danger red text. While `loading` it spins and takes no taps.
 */
export function Pill({
  variant = 's',
  size,
  icon,
  loading,
  disabled,
  href,
  to,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'p' | 's' | 'q' | 'd'
  size?: 'sm' | 'lg'
  icon?: ReactNode
  loading?: boolean
  href?: string
  to?: string
  target?: string
  rel?: string
  children?: ReactNode
}) {
  const cls = `btn ${variant} ${size ?? ''} ${className ?? ''}`.replace(/\s+/g, ' ').trim()
  const body = (
    <>
      {loading ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </>
  )
  if (to) {
    return (
      <Link to={to} className={cls} {...(rest as Record<string, unknown>)}>
        {body}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} className={cls} {...(rest as Record<string, unknown>)}>
        {body}
      </a>
    )
  }
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {body}
    </button>
  )
}

/** An icon button: a button, or a link when it has an address. A link takes only link attributes. */
type IconBtnProps =
  | (ButtonHTMLAttributes<HTMLButtonElement> & { label: string; href?: undefined })
  | (AnchorHTMLAttributes<HTMLAnchorElement> & { label: string; href: string })

export function IconBtn(props: IconBtnProps) {
  if (props.href !== undefined) {
    const { label, className, children, ...rest } = props
    return (
      <a aria-label={label} title={label} className={`ib ${className ?? ''}`.trim()} {...rest}>
        {children}
      </a>
    )
  }
  const { label, className, children, href: _, ...rest } = props
  return (
    <button type="button" aria-label={label} title={label} className={`ib ${className ?? ''}`.trim()} {...rest}>
      {children}
    </button>
  )
}

/** Filter chips: 40 px, selected white on ink, excluded red with a strike. */
export function Chip({ on, ex, n, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; ex?: boolean; n?: number }) {
  return (
    <button type="button" aria-pressed={!!on} className={`chip ${on ? 'on' : ''} ${ex ? 'ex' : ''}`} {...rest}>
      {children}
      {n != null && <span className="n">{n}</span>}
    </button>
  )
}

/** Segmented control: pill buttons on a plate, 44 px (40 small), every button at least 44 wide. */
export function Seg<T extends string>({
  value,
  onChange,
  options,
  label,
  small,
  scroll,
  className,
  disabled,
}: {
  value: T
  onChange?: (value: T) => void
  options: Array<{ value: T; label: ReactNode; disabled?: boolean; na?: boolean }>
  label?: string
  small?: boolean
  scroll?: boolean
  className?: string
  disabled?: boolean
}) {
  return (
    <div role="group" aria-label={label} className={`seg ${small ? 'sm' : ''} ${scroll ? 'scroll' : ''} ${className ?? ''}`.trim()}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled || o.disabled}
          className={`${o.value === value ? 'on' : ''} ${o.na ? 'na' : ''}`}
          onClick={() => onChange?.(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Five stars, each a 44 px radio button. Tapping the rating it already has clears it. */
export function Stars({ value, onChange, label = 'Your rating' }: { value: number; onChange: (value: number) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of 5`} className={n <= value ? 'on' : ''} onClick={() => onChange(value === n ? 0 : n)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
          </svg>
        </button>
      ))}
    </div>
  )
}

/** A switch: a 48 by 30 button with role="switch", its state exposed. */
export function LanternSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange?: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} style={disabled ? { opacity: 0.5 } : undefined} className={`sw ${checked ? 'on' : ''}`} onClick={() => onChange?.(!checked)} />
}

type SourceKind = 'def' | 'here' | 'you' | 'admin' | 'admin-you' | 'group' | 'server'

/** Every value says where it comes from. */
export function SourceLabel({ kind, label, onReset }: { kind: SourceKind; label?: string; onReset?: () => void }) {
  const text = {
    def: 'Default',
    here: 'Changed here',
    you: 'Your choice',
    admin: 'Set by the admin for everyone',
    'admin-you': 'Set by the admin for you',
    group: `Set by your sign-in group${label ? ` (${label})` : ''}`,
    server: `Fixed by the server${label ? ` (${label})` : ''}`,
  }[kind]
  const cls = kind === 'here' ? 'here' : kind === 'server' ? 'server' : kind === 'admin' || kind === 'admin-you' ? 'admin' : ''
  return (
    <span className={`src ${cls}`.trim()}>
      {text}
      {onReset && <a href="#" onClick={(e) => { e.preventDefault(); onReset() }}>Reset</a>}
    </span>
  )
}

export function Tag({ dim, children }: { dim?: boolean; children: ReactNode }) {
  return <span className={`tag ${dim ? 'dim' : ''}`}>{children}</span>
}

/** A progress bar in the brand gradient. */
/** A progress bar, `value` from 0 to 1. Indeterminate: a shimmer while the size is not known yet. */
export function Bar({ value, thin, indeterminate, style }: { value: number; thin?: boolean; indeterminate?: boolean; style?: CSSProperties }) {
  return (
    <div className={`bar ${thin ? 'thin' : ''}`} style={style}>
      {indeterminate ? <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 'inherit' }} /> : <i style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />}
    </div>
  )
}

/** Small label pill for tiles and rows (Update, Free, 18+, Beta). */
export function TagPill({ tone, children }: { tone?: 'pink' | 'vio' | 'green' | 'amber' | 'red' | 'dark'; children: ReactNode }) {
  return <span className={`pill ${tone ?? ''}`.trim()}>{children}</span>
}
