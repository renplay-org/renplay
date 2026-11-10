import type { MouseEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Frame, tintOf, useHidden, type ArtGame } from './art'
import { startTravel, travelSource } from './travel'

/**
 * The tile: the game's vertical (2:3 grid) art with the title and one meta
 * line under it. Every tile in a grid or a shelf has this one shape, so the
 * picture that flies from it to the stage never changes shape on the way.
 * Focus grows it 4 percent with the white ring and the tint glow.
 */
export default function Card({
  game,
  gameId = game.id,
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
  /** The game page's id, when the tile is a catalog entry for a game in the library. */
  gameId?: string
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
    const rect = e.currentTarget.querySelector('.frame')?.getBoundingClientRect()
    if (!rect) return
    startTravel({ id: gameId, src: travelSource(game.art, hidden), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } })
  }
  return (
    <Link
      to={href}
      className={`card ${on ? 'on' : ''} ${className ?? ''}`.replace(/\s+/g, ' ').trim()}
      data-focus
      data-id={gameId}
      tabIndex={0}
      style={{ ['--tint' as string]: tintOf(game.art) }}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      onClick={travel}
    >
      <Frame game={game} dim={dim} hidden={hidden} extra={extra} />
      <div className="ct">{title ?? game.title}</div>
      {meta && <div className="cm">{meta}</div>}
    </Link>
  )
}
