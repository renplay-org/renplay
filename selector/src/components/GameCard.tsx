import { CloudOff, Download, Play, Puzzle, Save } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { thumbUrl, type Game } from '../lib/api'
import { ago, pct } from '../lib/format'
import { Badge, Progress, cx } from './ui'

export function Cover({ game, className, rounded = true }: { game: Game; className?: string; rounded?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const src = thumbUrl(game)
  return (
    <div className={cx('relative overflow-hidden bg-ink-800', rounded && 'rounded-2xl', className)}>
      {!loaded && !failed && src && <div className="skeleton absolute inset-0" />}
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cx('absolute inset-0 size-full object-cover transition-opacity duration-500', loaded ? 'opacity-100' : 'opacity-0')}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-ink-700 via-ink-800 to-ink-900">
          <span className="px-6 text-center font-display text-xl font-semibold tracking-tight text-zinc-500">{game.title}</span>
        </div>
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
      <Link
        to={`/game/${game.slug}`}
        className="relative block overflow-hidden rounded-2xl ring-1 ring-white/[0.07] transition-all duration-300 hover:-translate-y-1 hover:ring-white/20 hover:shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
      >
        <Cover game={game} rounded={false} className={cx('aspect-video transition-transform duration-500 group-hover:scale-[1.03]', !installed && 'opacity-55 grayscale-[35%]')} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
        <div className="absolute left-3 top-3 flex gap-1.5">
          {!installed && !busy && (
            <Badge tone="neutral" className="glass">
              <CloudOff className="size-3" /> Not installed
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
              navigate(`/play/${game.slug}`)
            }}
            className="absolute right-3 top-3 flex size-11 translate-y-1 items-center justify-center rounded-full bg-white text-black opacity-0 shadow-xl transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 hover:scale-105"
            aria-label={`Play ${game.title}`}
          >
            <Play className="ml-0.5 size-5 fill-black" />
          </button>
        )}
        <div className="absolute inset-x-0 bottom-0 p-4">
          <h3 className="line-clamp-1 font-display text-[17px] font-semibold tracking-tight text-white drop-shadow">{game.title}</h3>
          {busy ? (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-zinc-300">
                <span className="truncate">{busy.status === 'queued' ? 'Queued' : busy.stage || 'Working'}</span>
                <span className="tabular-nums">{busy.status === 'running' ? pct(busy.progress) : ''}</span>
              </div>
              <Progress value={busy.progress} indeterminate={busy.status === 'queued'} />
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-3 text-[12px] text-zinc-400">
              {game.version && <span className="truncate">{game.version}</span>}
              {game.saves.count > 0 && (
                <span className="flex items-center gap-1">
                  <Save className="size-3" /> {game.saves.count}
                </span>
              )}
              {game.lastPlayedAt ? <span className="ml-auto shrink-0">{ago(game.lastPlayedAt)}</span> : !installed && game.canReinstall ? (
                <span className="ml-auto flex shrink-0 items-center gap-1 text-zinc-300">
                  <Download className="size-3" /> Install
                </span>
              ) : null}
            </div>
          )}
        </div>
      </Link>
    </div>
  )
}
