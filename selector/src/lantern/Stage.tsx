import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { formatFor, Frame, hashUrl, TitleArt, tintOf, useHidden, type ArtGame } from './art'
import { flyGhost, startTravel, takeTravel } from './travel'

/** Pressing Resume: the stage's art grows to the whole screen and becomes the door. */
export function travelToDoor(game: ArtGame & { id: string }, hidden: boolean, from?: Element | null): void {
  const frame = from ?? document.querySelector('.stage .cover .frame')
  const rect = frame?.getBoundingClientRect()
  if (!rect) return
  const f = formatFor(game.art, 'hero')
  const src = (!hidden && f?.url1x) || hashUrl(f?.thumbhash)
  startTravel({ id: game.id, src, rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } })
}

/** Crossfading art for the stage and the room: the previous picture stays under while the new one fades in. */
function Crossfade({ src, blur }: { src: string | null; blur?: boolean }) {
  const [layers, setLayers] = useState<Array<{ key: number; src: string | null }>>([{ key: 0, src }])
  const nextKey = useRef(1)
  useEffect(() => {
    setLayers((cur) => {
      if (cur[cur.length - 1]?.src === src) return cur
      return [...cur.slice(-1), { key: nextKey.current++, src }]
    })
    const t = window.setTimeout(() => setLayers((cur) => cur.slice(-1)), 380)
    return () => clearTimeout(t)
  }, [src])
  return (
    <>
      {layers.map((l, i) => l.src && <img key={l.key} src={l.src} alt="" className={i === layers.length - 1 && layers.length > 1 ? 'swap-layer' : ''} style={blur ? { filter: 'blur(40px) saturate(125%)', transform: 'scale(1.1)' } : undefined} />)}
    </>
  )
}

/** The stage art: the hero on desktop, the wide grid on phones, the picture or its hash. */
function StageArt({ game, kind, hidden }: { game: ArtGame; kind: 'hero' | 'wide'; hidden: boolean }) {
  const f = formatFor(game.art, kind)
  const src = (!hidden && f?.url1x) || hashUrl(f?.thumbhash)
  return (
    <div className={`art ${kind}-a`} aria-hidden="true">
      <Crossfade src={src} />
    </div>
  )
}

/** The stage poster: the grid, sunk into the art's bottom edge. A tile that travelled here lands on it. */
function StageCover({ game, hidden }: { game: ArtGame & { id: string }; hidden: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [settling, setSettling] = useState(false)
  useEffect(() => {
    const t = takeTravel(game.id)
    const el = ref.current
    if (!t || !el) return
    setSettling(true)
    requestAnimationFrame(() => {
      const target = el.getBoundingClientRect()
      // Where the cover ends up: the page is still rising in (each of main's children moves on its
      // own), so that offset comes off.
      let page: Element | null = el
      while (page && page.parentElement?.tagName !== 'MAIN') page = page.parentElement
      const moved = page ? getComputedStyle(page).transform : 'none'
      const rise = moved && moved !== 'none' ? new DOMMatrixReadOnly(moved) : null
      const dx = rise?.m41 ?? 0
      const dy = rise?.m42 ?? 0
      flyGhost(t, { x: target.x - dx, y: target.y - dy, w: target.width, h: target.height }, () => setSettling(false))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id])
  return (
    <div ref={ref} style={settling ? { opacity: 0 } : undefined}>
      <Frame game={game} kind="grid" hidden={hidden} />
    </div>
  )
}

/**
 * The stage: the game's door. The hero across the top on desktop, the wide
 * grid on phones, the grid sunk into its bottom edge, the logo or the title
 * beside it, actions below. The same component on the home, the game page and
 * the catalog.
 */
export default function Stage({
  game,
  eyebrow,
  meta,
  actions,
  body,
  back,
  actsRef,
}: {
  game: ArtGame & { id: string }
  eyebrow?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  /** Tags and summary, under the title on phones, in column two on desktop. */
  body?: ReactNode
  back?: { to: string; label: string }
  /** Watches the actions row: the phone action bar appears once it leaves view. */
  actsRef?: React.RefObject<HTMLDivElement | null>
}) {
  const hidden = useHidden(game)
  return (
    <section className="stage" data-id={game.id} style={{ ['--tint' as string]: tintOf(game.art) }}>
      <StageArt game={game} kind="hero" hidden={hidden} />
      <StageArt game={game} kind="wide" hidden={hidden} />
      {back && (
        <Link to={back.to} className="back">
          <ArrowLeft />
          {back.label}
        </Link>
      )}
      <div className="in">
        <div className="cover">
          <StageCover game={game} hidden={hidden} />
        </div>
        <div className="tb">
          <div className="in-t" key={game.id}>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <TitleArt game={game} hidden={hidden} />
            {meta && <div className="meta">{meta}</div>}
          </div>
        </div>
        {body && <div className="more">{body}</div>}
        {actions && (
          <div className="acts" ref={actsRef}>
            <div className="actions">{actions}</div>
          </div>
        )}
      </div>
    </section>
  )
}
