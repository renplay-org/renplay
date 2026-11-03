import { ArrowUpCircle, CloudOff, Download, Play, Puzzle, Save } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Game } from '../lib/api'
import { ago, capitalize, pct } from '../lib/format'
import { useBlurAdultCovers } from '../lib/prefs'
import { Badge, BetaBadge, cx, Progress } from './ui'

/** Shape of cover frames: itch.io's cover format (630×500), which most official art uses. */
export const COVER_ASPECT = 'aspect-[63/50]'

function hue(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

/** Stand-in for games without a cover: a tint from the title and its name. */
function TitleTile({ title }: { title: string }) {
  const h = hue(title)
  return (
    <div
      className="absolute inset-0 flex items-center justify-center overflow-hidden p-[8%]"
      style={{ background: `radial-gradient(130% 120% at 0% 0%, hsl(${h} 45% 34%), hsl(${(h + 35) % 360} 40% 16%) 55%, hsl(${(h + 60) % 360} 30% 8%))` }}
    >
      <span className="line-clamp-3 text-balance text-center font-display text-[clamp(1rem,7cqw,2.5rem)] font-bold leading-tight tracking-tight text-white/85">{title}</span>
    </div>
  )
}

/**
 * A game's cover in a frame of any shape. Art that does not match the frame's
 * shape is shown whole, over a blurred copy of itself, so logos are never cut
 * off. Adult games' covers are blurred when this browser asks for it.
 */
export function Cover({ game, className, rounded = true }: { game: Pick<Game, 'title' | 'cover'> & { nsfw?: boolean }; className?: string; rounded?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [fit, setFit] = useState<'cover' | 'contain' | null>(null)
  const [blurAdult] = useBlurAdultCovers()
  const frame = useRef<HTMLDivElement>(null)
  const src = game.cover
  const hidden = blurAdult && !!game.nsfw
  return (
    <div ref={frame} className={cx('@container relative overflow-hidden bg-ink-800', rounded && 'rounded-2xl', className)}>
      {!fit && !failed && src && <div className="skeleton absolute inset-0" />}
      {src && !failed ? (
        <div className={cx('absolute inset-0 transition-opacity duration-500', fit ? 'opacity-100' : 'opacity-0', hidden && 'scale-110 blur-2xl')}>
          {fit === 'contain' && <img src={src} alt="" aria-hidden="true" className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-xl" />}
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget
              const box = frame.current
              const art = img.naturalWidth / img.naturalHeight
              const shape = box && box.clientHeight ? box.clientWidth / box.clientHeight : art
              setFit(Math.abs(art - shape) / shape > 0.12 ? 'contain' : 'cover')
            }}
            onError={() => setFailed(true)}
            className={cx('absolute inset-0 size-full', fit === 'contain' ? 'object-contain drop-shadow-2xl' : 'object-cover')}
          />
        </div>
      ) : (
        <TitleTile title={game.title} />
      )}
      {hidden && src && !failed && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/50 px-2.5 py-1 text-xs font-semibold text-white/90 ring-1 ring-white/15 backdrop-blur">18+</span>
        </span>
      )}
    </div>
  )
}

export default function GameCard({ game, index = 0 }: { game: Game; index?: number }) {
  const navigate = useNavigate()
  const installed = game.status === 'installed'
  const busy = game.job
  return (
    <div className="group animate-rise" style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}>
      <Link to={`/game/${game.id}`} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
        <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/[0.08] transition-all duration-300 group-hover:-translate-y-1 group-hover:ring-white/20 group-hover:shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)]">
          <Cover game={game} rounded={false} className={cx(COVER_ASPECT, 'transition-transform duration-500 group-hover:scale-[1.03]', !installed && 'opacity-55 grayscale-[35%]')} />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            {!installed && !busy && (
              <Badge tone="neutral" className="glass">
                <CloudOff className="size-3" /> Not installed
              </Badge>
            )}
            {game.update && !busy && (
              <Badge tone="accent" className="glass">
                <ArrowUpCircle className="size-3" /> Update
              </Badge>
            )}
            {game.mods.files > 0 && (
              <Badge tone="violet" className="glass">
                <Puzzle className="size-3" /> Modded
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
            <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-black/90 to-black/40 p-3">
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
          <div className="mt-0.5 flex items-center gap-3 text-[12px] text-zinc-400">
            <BetaBadge engine={game.family} />
            {game.version && <span className="truncate">{game.version}</span>}
            {game.saves.count > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                <Save className="size-3" /> {game.saves.count}
              </span>
            )}
            {game.lastPlayedAt ? (
              <span className="ml-auto shrink-0">{capitalize(ago(game.lastPlayedAt))}</span>
            ) : !installed && game.canReinstall ? (
              <span className="ml-auto flex shrink-0 items-center gap-1 text-zinc-300">
                <Download className="size-3" /> Install
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </div>
  )
}
