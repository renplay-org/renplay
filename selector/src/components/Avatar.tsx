import { cx } from './ui'

export default function Avatar({ name, avatar, className }: { name: string; avatar?: string; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part.slice(0, 1)).join('').toUpperCase()
  return <span aria-hidden="true" className={cx('inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-violet-500 overflow-hidden font-semibold text-white', className)}>{avatar ? <img alt="" src={`/api/avatars/${avatar}`} className="size-full object-cover" /> : initials}</span>
}
