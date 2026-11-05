import { cx } from './ui'

export default function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part.slice(0, 1)).join('').toUpperCase()
  return <span aria-hidden="true" className={cx('inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-violet-500 font-semibold text-white', className)}>{initials}</span>
}
