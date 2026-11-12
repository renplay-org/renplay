import {
  ArrowLeft,
  Expand,
  Shrink,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatFor, hashUrl, TitleArt, useHidden } from '../../lantern/art'
import { Bar, Pill } from '../../lantern/controls'
import { flyGhost, takeTravel } from '../../lantern/travel'
import { cx } from '../../lantern/ui'
import type { Game } from '@shared/api'

/** The door: the hero across the whole screen, the logo or title and the loading bar at its bottom left. It ends when the game is ready, never after a minimum time. */
export default function Door({
  game,
  ready,
  resume,
  progress,
  loadPct,
  failed,
  slow,
  sandboxed,
  onRetry,
  onShowGame,
  muted,
  onMute,
  fsMode,
  fullscreen,
  onFullscreen,
  onBack,
  insets,
}: {
  muted: boolean
  onMute: () => void
  fsMode: 'api' | 'home-screen' | 'none'
  fullscreen: boolean
  onFullscreen: () => void
  onBack: () => void
  insets: { top: number; right: number; bottom: number; left: number }
  game: Game
  ready: boolean
  resume: string | null
  progress: { done: number; total: number } | null
  loadPct: number
  failed: string | null
  slow: boolean
  sandboxed: boolean
  onRetry: () => void
  onShowGame: () => void
}) {
  const hidden = useHidden(game)
  const hero = formatFor(game.art, 'hero')
  const art = (!hidden && hero?.url1x) || hashUrl(hero?.thumbhash)
  const [settling, setSettling] = useState(false)
  useEffect(() => {
    const t = takeTravel(game.id)
    if (!t) return
    setSettling(true)
    flyGhost(t, { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }, () => setSettling(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id])
  const status = failed ? 'Something went wrong' : sandboxed ? 'Loading game' : resume ? 'Loading your save' : !progress ? 'Starting engine' : loadPct >= 1 ? 'Starting game' : 'Loading game'
  return (
    <div inert={ready} className={cx('door', ready ? 'pointer-events-none opacity-0' : 'opacity-100')} style={{ transition: 'opacity .7s', zIndex: 10, position: 'absolute' }}>
      <div className={cx('art', hero?.made === 'glow' && 'blur')} style={settling ? { opacity: 0 } : undefined}>
        {art && <img src={art} alt="" />}
      </div>
      {/* While it loads: leave, and the sound and full screen, set before the game starts. */}
      <div className="door-bar" style={{ top: 12 + insets.top, left: 12 + insets.left, right: 12 + insets.right }}>
        <button type="button" className="door-btn" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          Game page
        </button>
        <span className="grow" />
        <button type="button" className="door-btn icon" aria-pressed={!muted} aria-label={muted ? 'Sound is off. Turn it on' : 'Sound is on. Turn it off'} onClick={onMute}>
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
        {fsMode !== 'none' && (
          <button type="button" className="door-btn icon" aria-label={fullscreen ? 'Leave full screen' : 'Full screen'} onClick={onFullscreen}>
            {fullscreen ? <Shrink aria-hidden="true" /> : <Expand aria-hidden="true" />}
          </button>
        )}
      </div>
      <div className="tb">
        <TitleArt game={game} hidden={hidden} />
        <div className="muted-2" style={{ marginTop: 8, fontSize: 14 }}>
          {resume ? `Resuming ${resume}` : 'Starting from the main menu'} · {status}
          {!failed && progress && progress.total > 0 ? <> <span className="tnum">{Math.round(loadPct * 100)}%</span></> : null}
        </div>
        {failed ? (
          <div className="stack" style={{ marginTop: 14, alignItems: 'flex-start', gap: 10 }}>
            <p className="red small">{failed}</p>
            <Pill onClick={onRetry}>Try again</Pill>
          </div>
        ) : (
          <div style={{ marginTop: 14, maxWidth: 360 }}>{progress && progress.total > 0 ? <Bar value={loadPct} /> : <Bar value={0} indeterminate />}</div>
        )}
        {slow && !failed && (
          <button onClick={onShowGame} className="link-q xs" style={{ marginTop: 14, display: 'inline-block' }}>
            Taking long? Show the game’s own loading screen
          </button>
        )}
      </div>
    </div>
  )
}
