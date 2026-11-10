import { useState, type CSSProperties, type ReactNode } from 'react'
import { thumbHashToDataURL } from 'thumbhash'
import type { ArtCredit, ArtFormat, ArtSet } from '@shared/art'
import type { ArtKind } from '@shared/recipe'
import { useAdultView } from '../lib/adult'

/** A game (or recipe) as the art system needs it. */
export type ArtGame = { title: string; art?: ArtSet; nsfw?: boolean }

/** A ThumbHash as an image address: the picture's colours and shapes in a few bytes. */
export function hashUrl(hash: string | null | undefined): string | null {
  if (!hash) return null
  try {
    return thumbHashToDataURL(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

export function hue(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** The game's colour: the most vivid tint its art carries, the room's and the focus ring's colour. */
export function tintOf(art: ArtSet | undefined): string {
  return art?.grid?.tint ?? art?.wide?.tint ?? art?.hero?.tint ?? art?.icon?.tint ?? '#5a5a7a'
}

/** The format for a place, with the fallbacks the making order guarantees. */
export function formatFor(art: ArtSet | undefined, kind: ArtKind): ArtFormat | null {
  if (!art) return null
  if (kind === 'grid') return art.grid ?? null
  if (kind === 'wide') return art.wide ?? art.hero ?? art.grid ?? null
  if (kind === 'hero') return art.hero ?? art.wide ?? art.grid ?? null
  if (kind === 'icon') return art.icon ?? art.grid ?? null
  return art.logo ?? null
}

/**
 * One format in its frame: the ThumbHash shows at once, the picture fades in
 * over 320 ms. Below Shown an adult game's format carries no address, so no
 * picture is ever requested.
 */
export function ArtPicture({ format, hidden, className = 'art' }: { format: ArtFormat; hidden?: boolean; className?: string }) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const hash = hashUrl(format.thumbhash)
  const src = !hidden && format.url1x && format.url1x !== failed ? format.url1x : null
  return (
    <>
      {hash && <img className="ph" src={hash} alt="" aria-hidden="true" />}
      {src && (
        <img
          className={`${className} ${loaded === src ? '' : 'loading'}`}
          src={src}
          srcSet={format.url2x && format.url2x !== src ? `${src} 1x, ${format.url2x} 2x` : undefined}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
        />
      )}
    </>
  )
}

/** Whether a game's pictures are hidden at the person's and this device's level. */
export function useHidden(game: ArtGame): boolean {
  const view = useAdultView()
  return !!game.nsfw && view !== 'shown'
}

/**
 * The tile frame in one of the fixed shapes: grid 2:3, wide 920x430, hero
 * 1920x620, square for the icon. A game with no picture at all is its title
 * on the brand glow. The 18+ tag marks adult games below Shown.
 */
export function Frame({
  game,
  kind = 'grid',
  dim,
  extra,
  className,
  hidden,
  style,
}: {
  game: ArtGame
  kind?: 'grid' | 'wide' | 'hero' | 'sq'
  dim?: boolean
  extra?: ReactNode
  className?: string
  hidden?: boolean
  style?: CSSProperties
}) {
  const artKind: ArtKind = kind === 'sq' ? 'icon' : kind
  const format = formatFor(game.art, artKind)
  const hid = hidden ?? useHidden(game)
  const cls = `frame ${kind === 'grid' ? '' : kind} ${dim ? 'dim' : ''} ${className ?? ''}`
  return (
    <div className={cls.trim()} style={{ containerType: 'inline-size', ['--tint' as string]: tintOf(game.art), ...style }}>
      {format ? <ArtPicture format={format} hidden={hid} /> : <div className="mono">{kind === 'sq' ? game.title.slice(0, 2) : game.title}</div>}
      {hid && kind !== 'sq' && <span className="pill dark tag18">18+</span>}
      {extra}
    </div>
  )
}

/** Where a picture came from, as one short phrase. */
export function creditText(credit: ArtCredit | undefined): ReactNode {
  if (!credit) return null
  if ('by' in credit)
    return (
      <>
        by{' '}
        {credit.asset ? (
          <a href={credit.asset} target="_blank" rel="noreferrer" className="link-q">
            {credit.by}
          </a>
        ) : (
          credit.by
        )}{' '}
        on SteamGridDB
      </>
    )
  if ('store' in credit) return <>from {credit.store}</>
  if ('renplay' in credit) return <>Default art by Renplay</>
  if ('upload' in credit) return <>uploaded</>
  return <>from the developer</>
}

/**
 * Whether the stage's own pictures already carry the game's title: the poster or the banner is real art
 * (from a store or SteamGridDB, which draw it), not a picture Renplay made from blur, which holds none.
 * The art data does not say more than that, so this is the best it can tell.
 */
export function artCarriesTitle(art: ArtSet | undefined): boolean {
  return [art?.grid, art?.hero].some((f) => f && f.made !== 'glow' && (f.url1x || f.thumbhash))
}

/** The stage and door title: the logo when there is one and pictures are on, otherwise text. A dark logo is inverted on ink. */
export function TitleArt({ game, hidden, className = 'h1 xl' }: { game: ArtGame; hidden: boolean; className?: string }) {
  const logo = game.art?.logo
  // The logo is the page's heading, and its size is known before it loads, so nothing moves when it does.
  if (logo?.url1x && !hidden)
    return (
      <h1 className="logo-h">
        <img className={`logo-t ${logo.dark ? 'inv' : ''}`} src={logo.url1x} srcSet={logo.url2x ? `${logo.url1x} 1x, ${logo.url2x} 2x` : undefined} width={logo.width} height={logo.height} style={logo.height ? ({ '--logo-h': `${logo.height}px` } as CSSProperties) : undefined} alt={game.title} />
      </h1>
    )
  return <h1 className={className}>{game.title}</h1>
}
