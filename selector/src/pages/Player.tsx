import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  Check,
  CloudOff,
  Expand,
  Loader2,
  Menu,
  MonitorSmartphone,
  RefreshCw,
  Save,
  Share,
  Shrink,
  Smartphone,
  SquarePlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Cover } from '../components/GameCard'
import { Button, IconButton, Progress, Spinner, Switch, cx } from '../components/ui'
import { post, slotName } from '../lib/api'
import {
  NO_INSETS,
  frameRect,
  fullscreenCoversNotch,
  fullscreenMode,
  isTouchDevice,
  loadPrefs,
  notchHeight,
  safeInsets,
  savePrefs,
  type DisplayPrefs,
  type Insets,
} from '../lib/display'
import { ago } from '../lib/format'
import { useGame, useSaves } from '../lib/queries'

type Panel = null | 'saves' | 'walkthrough' | 'display' | 'fullscreen'

/**
 * Keyboard Lock (Chromium): in fullscreen, a tap of Esc reaches the game
 * (Ren'Py's menu) and holding Esc leaves fullscreen. Elsewhere the browser
 * keeps Esc for leaving fullscreen.
 */
type KeyboardLock = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void }
const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
const canLockEscape = () => typeof keyboard()?.lock === 'function'
/** How long Chromium wants Esc held (kHoldEscapeTime in exclusive_access_manager.cc). */
const HOLD_ESCAPE_MS = 1500

/** Muting works like muting a tab, for every game in this browser; the runtime reads it at start. */
const MUTE_KEY = 'renplay:muted'

const HOME_TIP_KEY = 'renplay:home-screen-tip'

export default function Player() {
  const { id: gameId = '' } = useParams()
  const [params] = useSearchParams()
  const resume = params.get('resume')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: game, isLoading } = useGame(gameId)

  const shellRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [slow, setSlow] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [sync, setSync] = useState({ pending: 0, online: true, lastSync: 0 })
  const [toolbar, setToolbar] = useState(true)
  const [panel, setPanel] = useState<Panel>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [prefs, setPrefsState] = useState<DisplayPrefs>(loadPrefs)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [coversNotch, setCoversNotch] = useState(false)
  const [screenSize, setScreenSize] = useState<[number, number] | null>(null)
  const [exiting, setExiting] = useState(false)
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1')
  // Esc is locked (a tap reaches the game), shown as a hint for a few seconds,
  // and currently held down.
  const [escLocked, setEscLocked] = useState(false)
  const [escHint, setEscHint] = useState(false)
  const [escHeld, setEscHeld] = useState(false)
  const notch = useMemo(notchHeight, [])
  const touch = useMemo(isTouchDevice, [])
  const fsMode = useMemo(fullscreenMode, [])
  const [insets, setInsets] = useState<Insets>(NO_INSETS)
  const [portraitOk, setPortraitOk] = useState(false)
  const [homeTip, setHomeTip] = useState(() => fsMode === 'home-screen' && !localStorage.getItem(HOME_TIP_KEY))
  const hideTimer = useRef<number | null>(null)
  const resumed = useRef(false)
  const waiters = useRef(new Map<string, () => void>())

  const setPrefs = (p: DisplayPrefs) => {
    setPrefsState(p)
    savePrefs(p)
  }

  const send = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(msg, location.origin)
  }, [])

  // Messages from the in-game runtime.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frameRef.current?.contentWindow) return
      const d = e.data
      if (!d || typeof d.type !== 'string' || !d.type.startsWith('renplay:')) return
      switch (d.type) {
        case 'renplay:progress':
          setProgress({ done: d.done, total: d.total })
          break
        case 'renplay:ready':
          setReady(true)
          void post(`/api/games/${gameId}/played`).then(() => qc.invalidateQueries({ queryKey: ['games'] }))
          if (resume && !resumed.current) {
            resumed.current = true
            send({ type: 'renplay:load', slot: resume })
          }
          send({ type: 'renplay:focus' })
          break
        case 'renplay:sync':
          setSync({ pending: d.pending, online: d.online, lastSync: d.lastSync })
          break
        case 'renplay:info':
          if (Array.isArray(d.screen) && d.screen[0]) setScreenSize([d.screen[0], d.screen[1]])
          break
        case 'renplay:fullscreen':
          void toggleFullscreen(d.enable)
          break
        case 'renplay:flushed':
          waiters.current.get(d.id)?.()
          break
        case 'renplay:exited':
          navigate(`/game/${gameId}`)
          break
        case 'renplay:error':
          if (typeof d.message === 'string') setFailed(d.message)
          break
        case 'renplay:escape':
          setEscHeld(!!d.down)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, resume])

  useEffect(() => {
    if (game?.screen && !screenSize) setScreenSize(game.screen)
  }, [game, screenSize])

  useEffect(() => {
    if (ready) return
    const t = window.setTimeout(() => setSlow(true), 90_000)
    return () => clearTimeout(t)
  }, [ready])

  // Stage size for Fill mode.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The screen's real safe area (camera cutout, rounded corners, home indicator), per orientation.
  useEffect(() => {
    const update = () => setInsets(safeInsets())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  // Keep the screen on while playing (reading a long scene is not "idle").
  useEffect(() => {
    if (!ready || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let done = false
    const take = async () => {
      try {
        if (!done && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen')
      } catch {}
    }
    void take()
    document.addEventListener('visibilitychange', take)
    return () => {
      done = true
      document.removeEventListener('visibilitychange', take)
      void lock?.release().catch(() => {})
    }
  }, [ready])

  // Fullscreen.
  const toggleFullscreen = useCallback(
    async (want?: boolean) => {
      if (fsMode === 'home-screen') {
        if (want !== false) setPanel('fullscreen')
        return
      }
      if (fsMode !== 'api') return
      const on = !!document.fullscreenElement
      const target = want ?? !on
      try {
        if (target && !on) {
          await shellRef.current?.requestFullscreen({ navigationUI: 'hide' })
          // Phones: games are wide, so hold landscape while in fullscreen.
          if (touch) await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {})
          // Chrome may refuse the lock (it asks for permission since 130): then Esc just leaves.
          else if (keyboard()?.lock) setEscLocked(await keyboard()!.lock!(['Escape']).then(() => true, () => false))
        } else if (!target && on) await document.exitFullscreen()
      } catch {}
    },
    [fsMode, touch],
  )
  useEffect(() => {
    const onChange = () => {
      const on = !!document.fullscreenElement
      if (!on) {
        keyboard()?.unlock?.()
        setEscLocked(false)
        setEscHeld(false)
      }
      setFullscreen(on)
      send({ type: 'renplay:fullscreen-state', value: on })
      setTimeout(() => setCoversNotch(on && fullscreenCoversNotch()), 250)
      send({ type: 'renplay:focus' })
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [send])

  // Esc in fullscreen: say how to leave when it starts, and show the hold.
  useEffect(() => {
    if (!escLocked) return
    setEscHint(true)
    const t = setTimeout(() => setEscHint(false), 4000)
    return () => clearTimeout(t)
  }, [escLocked])
  useEffect(() => {
    if (!escLocked) return
    // When the player rather than the game has focus.
    const key = (down: boolean) => (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.repeat) setEscHeld(down)
    }
    const down = key(true)
    const up = key(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [escLocked])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    if (next) localStorage.setItem(MUTE_KEY, '1')
    else localStorage.removeItem(MUTE_KEY)
    send({ type: 'renplay:mute', value: next })
  }

  // Toolbar auto-hide.
  const showToolbar = useCallback(() => {
    setToolbar(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setToolbar(false), 2600)
  }, [])
  useEffect(() => {
    if (ready) showToolbar()
  }, [ready, showToolbar])
  const pinned = !ready || panel !== null || exiting

  const exit = useCallback(async () => {
    setExiting(true)
    const id = Math.random().toString(36).slice(2)
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 10_000)
      waiters.current.set(id, () => {
        clearTimeout(t)
        resolve()
      })
      send({ type: ready ? 'renplay:save-and-exit' : 'renplay:flush', id })
    })
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    void qc.invalidateQueries({ queryKey: ['saves', gameId] })
    void qc.invalidateQueries({ queryKey: ['games'] })
    navigate(`/game/${gameId}`)
  }, [navigate, qc, ready, send, gameId])

  // Space the game keeps clear of: a MacBook's notch in fullscreen, a phone's
  // camera cutout (the sides in landscape, the top in portrait). The home
  // indicator is only a thin line over the game, so the game may run under it.
  const avoid = prefs.avoidNotch
  const landscape = stage.w >= stage.h
  const pad = {
    top: Math.max(fullscreen && avoid && notch && coversNotch ? notch : 0, avoid && !landscape ? insets.top : 0),
    right: avoid && landscape ? insets.right : 0,
    bottom: 0,
    left: avoid && landscape ? insets.left : 0,
  }
  const area = { w: Math.max(0, stage.w - pad.left - pad.right), h: Math.max(0, stage.h - pad.top - pad.bottom) }
  const rect = frameRect(area.w, area.h, screenSize, prefs.fit)
  const hasCutout = notch > 0 || insets.top + insets.right + insets.bottom + insets.left > 0
  const portrait = touch && stage.h > stage.w && (!screenSize || screenSize[0] > screenSize[1])
  const dismissHomeTip = () => {
    localStorage.setItem(HOME_TIP_KEY, '1')
    setHomeTip(false)
  }

  if (isLoading)
    return (
      <div className="flex h-dvh items-center justify-center bg-black">
        <Spinner />
      </div>
    )
  if (!game || !game.playUrl)
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-black text-zinc-300">
        <p>This game is not installed.</p>
        <Button onClick={() => navigate(game ? `/game/${gameId}` : '/')}>Go back</Button>
      </div>
    )

  const loadPct = progress && progress.total ? progress.done / progress.total : 0

  return (
    <div ref={shellRef} className="fixed inset-0 touch-manipulation overflow-hidden overscroll-none bg-black text-white outline-none">
      {/* Game stage */}
      <div ref={stageRef} className={cx('absolute inset-0 transition-[right] duration-300', panel === 'walkthrough' && !fullscreen && 'md:right-[42%]')}>
        <div className="absolute overflow-hidden" style={{ top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left }}>
          <iframe
            ref={frameRef}
            key={attempt}
            src={game.playUrl}
            title={game.title}
            allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write"
            className="absolute border-0 bg-black outline-none"
            style={{ width: rect.width || '100%', height: rect.height || '100%', left: rect.left, top: rect.top }}
          />
        </div>
      </div>

      {/* Hot zone that reveals the toolbar, also while the game has focus. */}
      <div className="absolute inset-x-0 top-0 z-20 h-3" onMouseEnter={showToolbar} onClick={showToolbar} onTouchStart={showToolbar} />

      {/* Loader */}
      <div className={cx('absolute inset-0 z-10 flex flex-col items-center justify-center bg-black transition-opacity duration-700', ready ? 'pointer-events-none opacity-0' : 'opacity-100')}>
        <Cover game={game} rounded={false} className="absolute inset-0 scale-110 opacity-40 blur-2xl" />
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative flex w-full max-w-md flex-col items-center px-8 text-center">
          <Cover game={game} className="mb-8 aspect-[63/50] w-56 shadow-2xl ring-1 ring-white/15 sm:w-64" />
          <h1 className="font-display text-2xl font-semibold tracking-tight">{game.title}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {resume ? 'Loading your save…' : !progress ? 'Starting engine…' : loadPct >= 1 ? 'Starting game…' : 'Loading game…'}
          </p>
          {failed ? (
            <div className="mt-6 flex flex-col items-center gap-3">
              <p className="text-sm text-rose-300">{failed}</p>
              <button
                onClick={() => {
                  setFailed(null)
                  setProgress(null)
                  setAttempt((n) => n + 1)
                }}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-zinc-100 ring-1 ring-white/15 hover:bg-white/15"
              >
                Try again
              </button>
            </div>
          ) : (
            <Progress value={loadPct} indeterminate={!progress || !progress.total} className="mt-6 w-full" />
          )}
          {homeTip && (
            <div className="mt-8 flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 text-left text-sm text-zinc-300 ring-1 ring-white/10">
              <SquarePlus className="size-5 shrink-0 text-accent-300" />
              <span>
                For full screen, add Renplay to your home screen.{' '}
                <button className="font-medium text-accent-300" onClick={() => setPanel('fullscreen')}>
                  How
                </button>
              </span>
              <IconButton label="Dismiss" onClick={dismissHomeTip}>
                <X className="size-4" />
              </IconButton>
            </div>
          )}
          {slow && !failed && (
            <button onClick={() => setReady(true)} className="mt-6 text-xs text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline">
              Taking long? Show the game’s own loading screen
            </button>
          )}
        </div>
      </div>

      {/* Saving overlay */}
      {exiting && (
        <div className="absolute inset-0 z-50 flex animate-fade-in flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
          <Loader2 className="size-6 animate-spin text-accent-300" />
          <p className="text-sm text-zinc-200">Saving your progress…</p>
        </div>
      )}

      {/* Portrait phones: games are wide. */}
      {ready && portrait && !portraitOk && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 p-8 text-center backdrop-blur-sm">
          <Smartphone className="mb-2 size-10 rotate-90 text-accent-300" />
          <p className="text-lg font-semibold">Turn your phone sideways</p>
          <p className="max-w-xs text-sm text-zinc-400">{game.title} is made for a wide screen.</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setPortraitOk(true)}>
            Play upright anyway
          </Button>
        </div>
      )}

      {/* Touch screens cannot hover to reveal the toolbar. */}
      {touch && ready && !(toolbar || pinned) && (
        <button
          onClick={showToolbar}
          aria-label="Show the menu"
          className="absolute z-30 flex size-10 items-center justify-center rounded-full bg-black/45 text-white/80 opacity-55 ring-1 ring-white/15 backdrop-blur transition-opacity active:opacity-100"
          style={{ top: 8 + Math.max(insets.top, pad.top), left: 8 + insets.left }}
        >
          <Menu className="size-5" />
        </button>
      )}

      {/* Toolbar */}
      <div
        onMouseEnter={() => {
          if (hideTimer.current) clearTimeout(hideTimer.current)
          setToolbar(true)
        }}
        onMouseLeave={showToolbar}
        className={cx(
          'absolute inset-x-0 top-0 z-30 transition-all duration-300',
          toolbar || pinned ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0',
        )}
        style={{ paddingTop: Math.max(insets.top, pad.top), paddingLeft: insets.left, paddingRight: insets.right }}
      >
        <div className="flex items-center gap-2 bg-gradient-to-b from-black/80 via-black/50 to-transparent px-3 pb-6 pt-3 sm:px-5">
          <Button variant="glass" size="sm" icon={<ArrowLeft className="size-4" />} onClick={exit}>
            <span className="hidden sm:inline">Save & exit</span>
          </Button>
          <div className="ml-2 min-w-0">
            <div className="truncate text-sm font-semibold drop-shadow">{game.title}</div>
            {game.version && <div className="truncate text-[11px] text-zinc-400">{game.version}</div>}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <SyncBadge sync={sync} />
            <IconButton label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={toggleMute}>
              {muted ? <VolumeX className="size-[18px]" /> : <Volume2 className="size-[18px]" />}
            </IconButton>
            <IconButton label="Saves" active={panel === 'saves'} onClick={() => setPanel(panel === 'saves' ? null : 'saves')}>
              <Save className="size-[18px]" />
            </IconButton>
            {game.walkthrough && (
              <IconButton label="Walkthrough" active={panel === 'walkthrough'} onClick={() => setPanel(panel === 'walkthrough' ? null : 'walkthrough')}>
                <BookOpen className="size-[18px]" />
              </IconButton>
            )}
            <IconButton label="Display" active={panel === 'display'} onClick={() => setPanel(panel === 'display' ? null : 'display')}>
              <MonitorSmartphone className="size-[18px]" />
            </IconButton>
            {fsMode !== 'none' && (
              <IconButton label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => void toggleFullscreen()}>
                {fullscreen ? <Shrink className="size-[18px]" /> : <Expand className="size-[18px]" />}
              </IconButton>
            )}
          </div>
        </div>
      </div>

      {fullscreen && escLocked && (escHeld || escHint) && <EscapeHint held={escHeld} top={Math.max(insets.top, pad.top) + 16} />}

      {/* Panels */}
      {panel === 'saves' && (
        <SidePanel title="Saves" onClose={() => setPanel(null)} top={pad.top}>
          <SavesPanel
            gameId={gameId}
            onLoad={(slot) => {
              send({ type: 'renplay:load', slot })
              setPanel(null)
            }}
          />
        </SidePanel>
      )}
      {panel === 'display' && (
        <SidePanel title="Display" onClose={() => setPanel(null)} top={pad.top} narrow>
          <DisplayPanel
            prefs={prefs}
            setPrefs={setPrefs}
            notch={notch}
            hasCutout={hasCutout}
            fullscreen={fullscreen}
            coversNotch={coversNotch}
            screenSize={screenSize}
            area={area}
            fsMode={fsMode}
            onFullscreen={() => void toggleFullscreen()}
            onDownloadLog={() => send({ type: 'renplay:download-log' })}
          />
        </SidePanel>
      )}
      {panel === 'fullscreen' && (
        <SidePanel
          title="Full screen on iPhone"
          onClose={() => {
            dismissHomeTip()
            setPanel(null)
          }}
          top={pad.top}
          narrow
        >
          <HomeScreenHelp />
        </SidePanel>
      )}
      {panel === 'walkthrough' && game.walkthrough && (
        <div className="absolute inset-y-0 right-0 z-40 flex w-full flex-col border-l border-white/10 bg-ink-900 md:w-[42%]" style={{ top: pad.top }}>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold">Walkthrough</span>
            <IconButton label="Close walkthrough" onClick={() => setPanel(null)}>
              <X className="size-4" />
            </IconButton>
          </div>
          <iframe src={`/api/walkthroughs/${encodeURIComponent(game.walkthrough)}`} title="Walkthrough" className="min-h-0 flex-1 border-0 bg-white" />
        </div>
      )}
    </div>
  )
}

/** How to leave fullscreen, and while Esc is held, a ring that fills until it does. */
function EscapeHint({ held, top }: { held: boolean; top: number }) {
  const r = 9
  const c = 2 * Math.PI * r
  return (
    <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4 animate-fade-in" style={{ top }}>
      <div className="flex items-center gap-3 rounded-full bg-black/75 py-2 pl-2.5 pr-4 text-sm text-white ring-1 ring-white/15 backdrop-blur">
        <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-hidden="true">
          <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
          {held && (
            <circle
              key="hold"
              cx="12"
              cy="12"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c}
              style={{ animation: `escape-hold ${HOLD_ESCAPE_MS}ms linear forwards` }}
            />
          )}
        </svg>
        <span>
          {held ? (
            'Keep holding Esc to leave fullscreen'
          ) : (
            <>
              Hold <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-sans text-xs">Esc</kbd> to leave fullscreen. A short press opens the game’s menu.
            </>
          )}
        </span>
      </div>
    </div>
  )
}

function SyncBadge({ sync }: { sync: { pending: number; online: boolean; lastSync: number } }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const label = !sync.online
    ? 'Offline — saves are kept and will upload when the server is back'
    : sync.pending
      ? 'Uploading saves…'
      : sync.lastSync
        ? `Saves synced ${ago(sync.lastSync)}`
        : 'Saves are stored on the server'
  return (
    <span title={label} className="mr-1 hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-zinc-300 sm:flex">
      {!sync.online ? (
        <CloudOff className="size-3.5 text-amber-300" />
      ) : sync.pending ? (
        <RefreshCw className="size-3.5 animate-spin text-accent-300" />
      ) : (
        <Check className="size-3.5 text-emerald-400" />
      )}
      {!sync.online ? 'Offline' : sync.pending ? 'Syncing' : 'Synced'}
    </span>
  )
}

function SidePanel({ title, onClose, children, top, narrow }: { title: string; onClose: () => void; children: React.ReactNode; top: number; narrow?: boolean }) {
  return (
    <div className="absolute inset-0 z-40" style={{ top }}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className={cx('safe-x safe-bottom absolute bg-ink-900/95 backdrop-blur-xl bottom-0 right-0 top-0 flex w-full animate-rise flex-col border-l border-white/10', narrow ? 'sm:w-96' : 'sm:w-[440px]')}>
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

function SavesPanel({ gameId, onLoad }: { gameId: string; onLoad: (slot: string) => void }) {
  const { data, isLoading, refetch } = useSaves(gameId)
  useEffect(() => {
    void refetch()
  }, [refetch])
  const slots = (data?.slots ?? []).filter((s) => s.kind !== 'internal' && s.valid)
  if (isLoading) return <Spinner />
  if (!slots.length) return <p className="text-sm text-zinc-400">No saves yet. Save from the game’s menu, they are stored on the server automatically.</p>
  return (
    <div className="grid grid-cols-2 gap-3">
      {slots.map((s) => (
        <button key={s.file} onClick={() => onLoad(slotName(s.file))} className="group overflow-hidden rounded-xl bg-white/[0.04] text-left ring-1 ring-white/10 transition hover:ring-accent-400/60">
          <div className="aspect-video bg-ink-800">{s.screenshot && <img src={s.screenshot} alt="" className="size-full object-cover" loading="lazy" />}</div>
          <div className="p-2.5">
            <div className="truncate text-xs font-medium text-zinc-100">{s.name || s.label}</div>
            <div className="truncate text-[11px] text-zinc-400">
              {s.name ? `${s.label} · ` : ''}
              {ago(s.ctime)}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}

function HomeScreenHelp() {
  return (
    <div className="space-y-4 text-sm text-zinc-300">
      <p>Safari on iPhone only lets videos go full screen. Renplay can fill the whole screen when you open it from your home screen:</p>
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

function DisplayPanel({
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
  onDownloadLog: () => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-xs font-medium text-zinc-400">Scaling</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['fit', 'Fit', 'Whole game visible, bars where the shape differs'],
              ['fill', 'Fill', 'Fill the screen, cropping the edges'],
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
      <div className="flex items-center justify-between border-t border-white/[0.06] pt-4 text-xs text-zinc-500">
        <button onClick={onDownloadLog} className="hover:text-zinc-300">
          Download the game’s log
        </button>
        <a href="https://www.renpy.org/" target="_blank" rel="noreferrer" className="hover:text-zinc-300">
          Powered by Ren’Py
        </a>
      </div>
    </div>
  )
}
