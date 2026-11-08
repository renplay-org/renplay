import { cx } from '../lantern/ui'

export default function Avatar({ name, avatar, className, bare }: { name: string; avatar?: string; className?: string; bare?: boolean }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')
    .toUpperCase()
  const content = avatar ? <img alt="" src={`/api/avatars/${avatar}`} /> : initials
  if (bare) return <>{content}</>
  return (
    <span aria-hidden="true" className={cx('avatar', className)}>
      {content}
    </span>
  )
}
