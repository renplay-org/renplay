import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatFor, Frame, hashUrl, tintOf, useHidden, type ArtGame } from './art'
import { startTravel } from './travel'

/**
 * The tile: a grid (2:3) or a wide grid (2.14:1), with the title and one meta
 * line under it. Focus grows it 4 percent with the white ring and the tint
 * glow. Clicking it sends its picture travelling into the next screen's stage.
 */
export default function Card({
  game,
  kind = 'grid',
  href,
  title,
  meta,
  extra,
  dim,
  on,
  onFocus,
  onMouseEnter,
  onClick,
  className,
}: {
  game: ArtGame & { id: string }
  kind?: 'grid' | 'wide'
  href: string
  title?: ReactNode
  meta?: ReactNode
  /** Corner pills and bars inside the frame. */
  extra?: ReactNode
  dim?: boolean
  /** The lit tile in the Up next shelf: white ring and tint glow. */
  on?: boolean
  onFocus?: () => void
  onMouseEnter?: () => void
  /** Runs first; preventing the default keeps the click from travelling and navigating. */
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  className?: string
}) {
  const hidden = useHidden(game)
  const travel = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) return
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    // On a phone the page changes under the finger: the new page simply rises in, no flight.
    if (window.innerWidth < 720) return
    const rect = e.currentTarget.querySelector('.frame')?.getBoundingClientRect()
    if (!rect) return
    const f = formatFor(game.art, kind)
    const src = (!hidden && f?.url1x) || hashUrl(f?.thumbhash)
    startTravel({ id: game.id, src, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } })
  }
  return (
    <Link
      to={href}
      className={`card ${kind === 'wide' ? 'wide' : ''} ${on ? 'on' : ''} ${className ?? ''}`.replace(/\s+/g, ' ').trim()}
      data-focus
      data-id={game.id}
      tabIndex={0}
      style={{ ['--tint' as string]: tintOf(game.art) }}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      onClick={travel}
    >
      <Frame game={game} kind={kind} dim={dim} hidden={hidden} extra={extra} />
      <div className="ct">{title ?? game.title}</div>
      {meta && <div className="cm">{meta}</div>}
    </Link>
  )
}
