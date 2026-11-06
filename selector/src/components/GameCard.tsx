import { ArrowUpCircle, Heart, Play } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { thumbHashToDataURL } from 'thumbhash'
import type { ArtCredit, ArtKind, ArtSet, Game } from '../lib/api'
import { ago, capitalize, pct } from '../lib/format'
import { useAdultView } from '../lib/adult'
import { Badge, BetaBadge, cx, Progress } from './ui'

/** Shape of cover frames: itch.io's cover format (630×500), which most official art uses. */
export const COVER_ASPECT = 'aspect-[63/50]'

export function hue(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** Stand-in for games without a cover: a tint from the title and its name. */
export function TitleTile({ title }: { title: string }) {
  const h = hue(title)
  return (
    <div
      className="absolute inset-0 flex items-end justify-start overflow-hidden p-[8%]"
      style={{ background: `radial-gradient(130% 120% at 0% 0%, hsl(${h} 45% 34%), hsl(${(h + 35) % 360} 40% 16%) 55%, hsl(${(h + 60) % 360} 30% 8%))` }}
    >
      <span className="line-clamp-3 text-balance text-left font-display text-[clamp(1rem,11cqw,2.5rem)] font-bold leading-tight tracking-tight text-white/85">{title}</span>
    </div>
  )
}

/** A ThumbHash as an image address: the picture's colours and shapes in a few bytes. */
export function hashUrl(hash: string | null | undefined): string | null {
  if (!hash) return null
  try {
    return thumbHashToDataURL(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

/**
 * One of a game's formats in a frame of any shape. The ThumbHash shows at once and the picture
 * fades in over it. A picture that does not match the frame's shape is shown whole, over a blurred
 * copy of itself. Below Shown an adult game is its hash with an 18+ tag, and the server sends no
 * address, so nothing is requested. A game with no picture at all is a title card.
 */
export function Cover({ game, kind = 'grid', className, rounded = true }: { game: Pick<Game, 'title'> & { art?: ArtSet; nsfw?: boolean }; kind?: ArtKind; className?: string; rounded?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [fit, setFit] = useState<'cover' | 'contain'>('cover')
  const view = useAdultView()
  const frame = useRef<HTMLDivElement>(null)
  const format = game.art?.[kind] ?? (kind !== 'grid' ? game.art?.grid : undefined)
  const hidden = !!game.nsfw && view !== 'shown'
  const src = !hidden && format?.url1x && format.url1x !== failed ? format.url1x : null
  const hash = hashUrl(format?.thumbhash)
  return (
    <div ref={frame} className={cx('@container relative overflow-hidden bg-ink-800', rounded && 'rounded-2xl', className)} style={format?.tint ? { backgroundColor: format.tint } : undefined}>
      {format ? (
        <>
          {hash && <img src={hash} alt="" aria-hidden="true" className={cx('absolute inset-0 size-full object-cover', hidden && 'scale-110 blur-md')} />}
          {src && (
            <div className={cx('absolute inset-0 transition-opacity duration-300', loaded === src ? 'opacity-100' : 'opacity-0')}>
              {fit === 'contain' && <img src={src} alt="" aria-hidden="true" className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-xl" />}
              <img
                src={src}
                srcSet={format.url2x && format.url2x !== src ? `${src} 1x, ${format.url2x} 2x` : undefined}
                alt=""
                loading="lazy"
                decoding="async"
                onLoad={(e) => {
                  const img = e.currentTarget
                  const box = frame.current
                  const art = img.naturalWidth / img.naturalHeight
                  const shape = box && box.clientHeight ? box.clientWidth / box.clientHeight : art
                  setFit(Math.abs(art - shape) / shape > 0.12 ? 'contain' : 'cover')
                  setLoaded(src)
                }}
                onError={() => setFailed(src)}
                className={cx('absolute inset-0 size-full', fit === 'contain' ? 'object-contain drop-shadow-2xl' : 'object-cover')}
              />
            </div>
          )}
        </>
      ) : (
        <TitleTile title={game.title} />
      )}
      {hidden && (
        <span className="absolute right-2 top-2 flex">
          <span className="rounded-full bg-black/50 px-2.5 py-1 text-xs font-semibold text-white/90 ring-1 ring-white/15 backdrop-blur">18+</span>
        </span>
      )}
    </div>
  )
}

/** Where a picture came from, as one short phrase. */
export function creditText(credit: ArtCredit | undefined): ReactNode {
  if (!credit) return null
  if ('by' in credit) return <>by {credit.asset ? <a href={credit.asset} target="_blank" rel="noreferrer" className="underline decoration-white/30 hover:decoration-white">{credit.by}</a> : credit.by} on SteamGridDB</>
  if ('store' in credit) return <>from {credit.store}</>
  if ('renplay' in credit) return <>Default art by Renplay</>
  if ('upload' in credit) return <>uploaded</>
  return <>from the developer</>
}

export default function GameCard({ game, index = 0 }: { game: Game; index?: number }) {
  const navigate = useNavigate()
  const installed = game.status === 'installed'
  const busy = game.job
  return (
    <div className="group animate-rise" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
      <Link to={`/game/${game.id}`} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
        <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/[0.08] transition-all duration-300 group-hover:-translate-y-1 group-hover:ring-white/20 group-hover:shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)]">
          <Cover game={game} rounded={false} className={cx(COVER_ASPECT, 'transition-transform duration-500 group-hover:scale-[1.03]', !installed && 'opacity-55')} />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            {game.update && !busy && (
              <Badge tone="accent" className="glass">
                <ArrowUpCircle className="size-3" /> Update
              </Badge>
            )}
          </div>
          {installed && game.playUrl && !busy && (
            <button
              onClick={(e) => {
                e.preventDefault()
                navigate(`/play/${game.id}`)
              }}
              className="absolute bottom-2.5 right-2.5 flex size-11 translate-y-1 items-center justify-center rounded-full bg-white text-black opacity-0 shadow-xl transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105 [@media(hover:none)]:size-10 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100"
              aria-label={`Play ${game.title}`}
            >
              <Play className="ml-0.5 size-5 fill-black" />
            </button>
          )}
          {busy && (
            <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-black/80 p-3 backdrop-blur-sm">
              <div className="flex items-center justify-between text-[11px] text-zinc-200">
                <span className="truncate">{busy.status === 'queued' ? 'Queued' : busy.stage || 'Working'}</span>
                <span className="tabular-nums">{busy.status === 'running' ? pct(busy.progress) : ''}</span>
              </div>
              <Progress value={busy.progress} indeterminate={busy.status === 'queued'} />
            </div>
          )}
        </div>
        <div className="px-0.5 pt-2.5">
          <h3 className="line-clamp-1 text-[15px] font-semibold tracking-tight text-white">{game.title}</h3>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-zinc-400">
            {game.favoriteAt && <Heart aria-label="Favourite" className="size-3 shrink-0 fill-current text-rose-300" />}
            <BetaBadge engine={game.family} />
            {game.version && <span className="max-w-20 truncate text-zinc-500">{game.version}</span>}
            {game.lastPlayedAt ? (
              <span className="truncate">{capitalize(ago(game.lastPlayedAt))}</span>
            ) : <span>{installed ? 'Not played yet' : 'Not installed'}</span>}
          </div>
        </div>
      </Link>
    </div>
  )
}
