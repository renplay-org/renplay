import {
  Expand,
  Pin,
  Share,
  Shrink,
  Smartphone,
  SquarePlus,
  X,
} from 'lucide-react'
import SceneCard from '../../components/SceneCard'
import DocsLink from '../../components/DocsLink'
import { useEffect, useState } from 'react'
import { Seg } from '../../lantern/controls'
import { Button, IconButton, Spinner, Switch, cx } from '../../components/ui'
import { slotName } from '../../lib/format'
import {
  type DisplayPrefs,
} from '../../lib/display'
import { ago } from '../../lib/format'
import { useGame, useSaves } from '../../lib/queries'
import { canLockEscape } from './keyboard'

export function SidePanel({ title, onClose, children, top, narrow }: { title: string; onClose: () => void; children: React.ReactNode; top: number; narrow?: boolean }) {
  return (
    <div className="absolute inset-0 z-40" style={{ top }}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className={cx('safe-x safe-bottom absolute bg-ink-900/95 backdrop-blur-xl bottom-0 right-0 max-h-[85%] sm:max-h-none sm:top-0 flex w-full animate-rise flex-col rounded-t-3xl sm:rounded-none border-l border-white/10', narrow ? 'sm:w-96' : 'sm:w-[440px]')}>
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-6">{children}</div>
      </aside>
    </div>
  )
}

export function SavesPanel({ gameId, onLoad }: { gameId: string; onLoad: (slot: string) => void }) {
  const { data, isLoading, refetch } = useSaves(gameId)
  const { data: saveGame } = useGame(gameId)
  useEffect(() => {
    void refetch()
  }, [refetch])
  const [filter, setFilter] = useState<'all' | 'pinned' | 'manual' | 'auto' | 'quick'>('all')
  const all = (data?.slots ?? []).filter((s) => s.kind !== 'internal' && s.valid)
  if (isLoading) return <Spinner />
  if (!all.length) return <p className="text-sm text-zinc-400">No saves yet. Saves you make in the game are stored on the server as you make them.</p>
  const pinned = all.filter((s) => s.pinnedAt).length
  const kinds = (['manual', 'auto', 'quick'] as const).filter((k) => all.some((s) => s.kind === k))
  // Pinned saves first, then the newest.
  const slots = all
    .filter((s) => filter === 'all' || (filter === 'pinned' ? !!s.pinnedAt : s.kind === filter))
    .sort((a, b) => Number(!!b.pinnedAt) - Number(!!a.pinnedAt) || b.ctime - a.ctime)
  return (
    <div className="stack" style={{ gap: 12 }}>
      {(pinned > 0 || kinds.length > 1) && (
        <Seg
          small
          scroll
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all' as const, label: 'All' },
            ...(pinned ? [{ value: 'pinned' as const, label: 'Pinned' }] : []),
            ...kinds.map((k) => ({ value: k, label: `${k[0]!.toUpperCase()}${k.slice(1)}` })),
          ]}
        />
      )}
      <div className="pd-saves">
        {slots.map((s) => (
          <button key={s.file} onClick={() => onLoad(slotName(s.file))} className={cx('pd-save group flex flex-col justify-start overflow-hidden rounded-xl bg-white/[0.04] text-left ring-1 ring-white/10 transition hover:ring-accent-400/60', s.pinnedAt && 'pinned')}>
            {saveGame && <SceneCard game={saveGame} save={s} className="rounded-none" />}
            <div className="p-2.5">
              <div className="row truncate text-xs font-medium text-zinc-100" style={{ gap: 4 }}>
                {s.pinnedAt && <Pin className="size-3 shrink-0" style={{ color: 'var(--amber)' }} aria-label="Pinned" />}
                <span className="truncate">{s.title || s.name || s.label}</span>
              </div>
              {s.note && <div className="pd-note text-[11px] text-zinc-300">{s.note}</div>}
              <div className="truncate text-[11px] text-zinc-400">
                {s.title || s.name ? `${s.label} · ` : ''}
                {ago(s.ctime)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function HomeScreenHelp() {
  return (
    <div className="space-y-4 text-sm text-zinc-300">
      <p>Safari on iPhone only lets videos go full screen. Renplay can fill the whole screen when you open it from your home screen:</p>
      <DocsLink path="guides/playing/">Playing on iPhone</DocsLink>
      <ol className="space-y-3">
        <li className="flex items-center gap-3">
          <Share className="size-5 shrink-0 text-accent-300" />
          <span>Tap the Share button in Safari.</span>
        </li>
        <li className="flex items-center gap-3">
          <SquarePlus className="size-5 shrink-0 text-accent-300" />
          <span>Choose Add to Home Screen.</span>
        </li>
        <li className="flex items-center gap-3">
          <Smartphone className="size-5 shrink-0 rotate-90 text-accent-300" />
          <span>Open Renplay from the home screen and hold the phone sideways.</span>
        </li>
      </ol>
      <p className="text-zinc-400">Saves are on the server, so you continue where you left off on any device.</p>
    </div>
  )
}

export function DisplayPanel({
  prefs,
  setPrefs,
  notch,
  hasCutout,
  fullscreen,
  coversNotch,
  screenSize,
  area,
  fsMode,
  onFullscreen,
  onDownloadLog,
}: {
  prefs: DisplayPrefs
  setPrefs: (p: DisplayPrefs) => void
  notch: number
  hasCutout: boolean
  fullscreen: boolean
  coversNotch: boolean
  screenSize: [number, number] | null
  area: { w: number; h: number }
  fsMode: 'api' | 'home-screen' | 'none'
  onFullscreen: () => void
  /** Ren'Py games only. */
  onDownloadLog?: () => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-medium text-zinc-400">Scaling</p>
        <div className="pd-pair">
          {(
            [
              ['fit', 'Fit', 'The whole game, with bars where the screen has another shape'],
              ['fill', 'Fill', 'No bars at the sides. The edges are cropped, never the top or bottom'],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              onClick={() => setPrefs({ ...prefs, fit: id })}
              className={cx('rounded-xl p-3 text-left ring-1 ring-inset transition', prefs.fit === id ? 'bg-accent-500/15 ring-accent-400/50' : 'bg-white/[0.04] ring-white/10 hover:bg-white/[0.07]')}
            >
              <div className="text-sm font-medium">{label}</div>
              <div className="mt-1 text-[11px] leading-snug text-zinc-400">{hint}</div>
            </button>
          ))}
        </div>
        {screenSize && area.w > 0 && (
          <p className="mt-2 text-[11px] text-zinc-500">
            Game {screenSize[0]}×{screenSize[1]} ({(screenSize[0] / screenSize[1]).toFixed(2)}:1) · Screen area {area.w}×{area.h} ({(area.w / area.h).toFixed(2)}:1)
          </p>
        )}
      </div>
      {hasCutout && (
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-400">Camera cutout</p>
          <Switch
            checked={prefs.avoidNotch}
            onChange={(v) => setPrefs({ ...prefs, avoidNotch: v })}
            label="Keep the game clear of the camera"
            hint={
              notch > 0
                ? fullscreen && !coversNotch
                  ? 'Your browser already keeps the notch area black in fullscreen.'
                  : `In fullscreen the top ${notch}px strip below the camera stays black when this is on. Off uses the full screen height.`
                : 'On keeps the game clear of the camera cutout. Off uses the whole screen.'
            }
          />
        </div>
      )}
      {fsMode === 'api' && (
        <div>
          <Button variant="secondary" className="w-full" icon={fullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />} onClick={onFullscreen}>
            {fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          </Button>
          <p className="mt-2 text-[11px] leading-snug text-zinc-500">
            {canLockEscape()
              ? 'In fullscreen, Esc opens the game’s menu. Hold Esc to leave fullscreen.'
              : 'In fullscreen, this browser keeps Esc for leaving it. Right-click opens the game’s menu.'}
          </p>
        </div>
      )}
      {fsMode === 'home-screen' && (
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-400">Full screen</p>
          <HomeScreenHelp />
        </div>
      )}
      {onDownloadLog && (
        <div className="flex items-center justify-between border-t border-white/[0.06] pt-4 text-xs text-zinc-500">
          <button onClick={onDownloadLog} className="hover:text-zinc-300">
            Download the game’s log
          </button>
          <a href="https://www.renpy.org/" target="_blank" rel="noreferrer" className="hover:text-zinc-300">
            Powered by Ren’Py
          </a>
        </div>
      )}
    </div>
  )
}
