import { useQueryClient } from '@tanstack/react-query'
import {
  CloudOff,
  Expand,
  Loader2,
  RefreshCw,
  Shrink,
  Smartphone,
} from 'lucide-react'
import { GuideList, GuideWindow, PlayerDrawer, type DrawerTab } from '../components/PlayerDrawer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Confirm, Spinner, Switch, cx, useToast } from '../lantern/ui'
import { useAuth } from '../lib/auth'
import { api, userHeader } from '../lib/api'
import {
  frameRect,
  fullscreenMode,
  loadPrefs,
  notchHeight,
  savePrefs,
  type DisplayPrefs,
} from '../lib/display'
import { isTouchDevice } from '../lib/platform'
import { useDefaults, useGame } from '../lib/queries'
import type { Defaults } from '@shared/defaults'
import { keptGame, useOnline } from '../lib/offline'
import { setGameHasPad } from '../lib/gamepad'
import type { Me } from '@shared/api'
import { isRenpy } from '@shared/family'
import Door from './player/Door'
import EscapeHint from './player/EscapeHint'
import { SLOW_SYNC, useSlow } from './player/useSlow'
import { DisplayPanel, HomeScreenHelp, SavesPanel, SidePanel } from './player/panels'
import { useFullscreen } from './player/useFullscreen'
import { useMute } from './player/useMute'
import { useHtmlSaves, useSaving } from './player/useSaving'
import { usePlayTime } from './player/usePlayTime'
import { useTelemetry } from './player/useTelemetry'
import { useElementSize, useSafeInsets, useWakeLock } from './player/useScreen'
import GameOptions, { type GameOptionsState } from './player/GameOptions'
import { Bar, Pill } from '../lantern/controls'
import { useModal } from '../lantern/modal'

type Panel = null | 'fullscreen'


const HOME_TIP_KEY = 'renplay:home-screen-tip'

export default function Player() {
  const { data: account } = useAuth()
  const userId = useRef(account!.user.id).current
  const [signedOut, setSignedOut] = useState(false)
  const signedOutRef = useRef<HTMLElement>(null)
  // It stays until the person signs in again and continues: Escape does not close it.
  useModal(signedOutRef, signedOut, null)
  const [signInError, setSignInError] = useState('')
  const { id: gameId = '' } = useParams()
  const [params] = useSearchParams()
  const resume = params.get('resume')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: game, isLoading } = useGame(gameId)
  const online = useOnline()

  useEffect(() => {
    document.title = game ? `${game.title} · Renplay` : 'Renplay'
    return () => { document.title = 'Renplay' }
  }, [game?.title])

  const shellRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const [slow, setSlow] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [sync, setSync] = useState({ pending: 0, online: true, lastSync: 0 })
  const slowSync = useSlow(sync.pending > 0, SLOW_SYNC)
  const [drawer, setDrawer] = useState<DrawerTab | null>(null)
  const [guide, setGuide] = useState<string | null>(null)
  const toast = useToast()
  const [panel, setPanel] = useState<Panel>(null)
  // The pill and the full screen button are lit for a few seconds after the game is ready, then quiet.
  const [freshPill, setFreshPill] = useState(true)
  const [prefs, setPrefsState] = useState<DisplayPrefs>(loadPrefs)
  const [screenSize, setScreenSize] = useState<[number, number] | null>(null)
  const [exiting, setExiting] = useState(false)
  // Save and exit could not get every save to the server: where the person meant to go.
  const [unsent, setUnsent] = useState<'library' | 'game' | null>(null)
  // Ren'Py games: the patches this person chose and the text size, as the game reports them.
  const [gameOptions, setGameOptions] = useState<GameOptionsState | null>(null)
  // Defaults for everyone, sent with every options message so a game uses them until the person chooses.
  const defaults = useDefaults()
  const defaultsRef = useRef<Defaults | undefined>(undefined)
  defaultsRef.current = defaults.data
  const sendOptions = (extra: Record<string, unknown>) => send({ type: 'renplay:options', defaults: defaultsRef.current, ...extra })
  const notch = useMemo(notchHeight, [])
  const touch = useMemo(isTouchDevice, [])
  const fsMode = useMemo(fullscreenMode, [])
  const [portraitOk, setPortraitOk] = useState(false)
  const resumed = useRef(false)
  // Other engines run their own JavaScript, so they play in a sandboxed frame
  // (opaque origin, no access to Renplay) and their storage comes through here.
  const sandboxed = !!game && !isRenpy(game)
  // The drawer's first tab. Other engines' games have no saves of their own.
  const firstTab: DrawerTab = sandboxed ? 'options' : 'saves'
  const openDrawer = () => setDrawer(firstTab)

  const setPrefs = (p: DisplayPrefs) => {
    setPrefsState(p)
    savePrefs(p)
  }

  const send = useCallback(
    (msg: Record<string, unknown>) => {
      // An opaque origin cannot be named; the message goes to that frame only.
      frameRef.current?.contentWindow?.postMessage(msg, sandboxed ? '*' : location.origin)
    },
    [sandboxed],
  )
  const [muted, toggleMute] = useMute(send)
  const saving = useSaving(send, ready, toast)
  const htmlSaves = useHtmlSaves(sandboxed, userId, gameId, attempt, send, () => setSignedOut(true), setFailed)
  const { fullscreen, coversNotch, escLocked, escHint, escHeld, setEscHeld, toggleFullscreen } = useFullscreen(shellRef, fsMode, touch, send, () => setPanel('fullscreen'))
  const stage = useElementSize(stageRef, `${game?.id}:${isLoading}`)
  const insets = useSafeInsets()
  useWakeLock(ready)
  usePlayTime(ready && !exiting && !failed, gameId, userId, sandboxed, frameRef, () => setSignedOut(true))
  const telemetry = useTelemetry(gameId, userId, { ready, online, fullscreen, failed })
  // On an iPhone in Safari, once the game has started and never while it loads: once, how to get full screen.
  useEffect(() => {
    if (!ready || fsMode !== 'home-screen' || localStorage.getItem(HOME_TIP_KEY)) return
    localStorage.setItem(HOME_TIP_KEY, '1')
    toast(
      <>
        For full screen, add Renplay to your home screen.{' '}
        <button className="link" onClick={() => setPanel('fullscreen')}>
          How
        </button>
      </>,
    )
  }, [ready, fsMode, toast])

  useEffect(() => {
    const signedOut = () => setSignedOut(true)
    window.addEventListener('renplay:signed-out', signedOut)
    return () => window.removeEventListener('renplay:signed-out', signedOut)
  }, [])

  // Messages from the in-game runtime.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return
      if (e.origin !== (sandboxed ? 'null' : location.origin)) return
      const d = e.data
      if (!d || typeof d.type !== 'string' || !d.type.startsWith('renplay:')) return
      if (sandboxed && d.userId !== userId) return
      switch (d.type) {
        case 'renplay:signed-out':
          setSignedOut(true)
          break
        case 'renplay:progress':
          setProgress({ done: d.done, total: d.total })
          break
        case 'renplay:ready':
          setReady(true)
          void api(`/api/games/${gameId}/played`, { method: 'POST', headers: userHeader(userId) }).then(() => qc.invalidateQueries({ queryKey: ['games'] })).catch(() => {})
          if (resume && !resumed.current) {
            resumed.current = true
            send({ type: 'renplay:load', slot: resume })
          }
          send({ type: 'renplay:focus' })
          send({ type: 'renplay:mute', value: muted })
          // This person's patches and text size (or the defaults for everyone), applied now and read back for Options.
          if (!sandboxed) send({ type: 'renplay:options', defaults: defaultsRef.current })
          break
        case 'renplay:options':
          if (d.ok) setGameOptions({ patches: d.patches ?? {}, fontSize: typeof d.fontSize === 'number' ? d.fontSize : 1, patchesFrom: d.patchesFrom ?? 'default', sizeFrom: d.sizeFrom ?? 'default' })
          else toast('The game did not take that change.')
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
          // After the storage that came before it is stored.
          void htmlSaves.kept().finally(() => saving.flushed(d.id, d.ok !== false))
          break
        case 'renplay:saved-now':
          saving.savedNow(d.id, !!d.saved, !!d.ok)
          break
        case 'renplay:save-conflict':
          toast(
            d.deleted
              ? 'Another device saved this save after you deleted it here, so it is back.'
              : d.kept === 'other'
                ? 'Another device saved over this save more recently. Its copy is in the slot, and yours is kept in History.'
                : 'Another device also saved this save. Yours is newer and is in the slot. The other copy is kept in History.',
            'info',
          )
          void qc.invalidateQueries({ queryKey: ['saves', game?.id] })
          break
        case 'renplay:download-log':
          if (d.ok === false) toast('This game has not written a log yet.')
          break
        case 'renplay:accessibility':
          if (!d.ok) toast('This game does not offer Ren’Py’s accessibility menu.')
          break
        case 'renplay:storage':
          // A game's whole storage, kept within the size a save file may have on the server.
          if (sandboxed && typeof d.data === 'string' && d.data.length <= 32 << 20 && game?.saveDir) htmlSaves.store(game.saveDir, d.kind, d.data)
          break
        case 'renplay:exited':
          void qc.invalidateQueries({ queryKey: ['games'] })
          void qc.invalidateQueries({ queryKey: ['game', gameId] })
          void qc.invalidateQueries({ queryKey: ['saves', gameId] })
          navigate(`/game/${gameId}`)
          break
        case 'renplay:error':
          if (typeof d.message === 'string') setFailed(d.message)
          break
        case 'renplay:escape':
          setEscHeld(!!d.down)
          break
        case 'renplay:perf':
          if (typeof d.fps === 'number') telemetry.fps(d.fps)
          break
        case 'renplay:menu':
          // The controller's Menu button in the game.
          setDrawer((tab) => tab ?? firstTab)
          break
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, resume, sandboxed, game?.saveDir, muted])


  useEffect(() => {
    if (game?.screen && !screenSize) setScreenSize(game.screen)
  }, [game, screenSize])

  useEffect(() => {
    if (ready) return
    const t = window.setTimeout(() => setSlow(true), 90_000)
    return () => clearTimeout(t)
  }, [ready])







  const closeDrawer = useCallback(() => {
    setDrawer(null)
    send({ type: 'renplay:focus' })
  }, [send])

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setFreshPill(false), 5000)
    return () => clearTimeout(t)
  }, [ready])

  // The drawer has the controller while it is open, and its Menu button closes it again.
  useEffect(() => {
    if (ready && !sandboxed) send({ type: 'renplay:pads', toGame: !drawer })
    setGameHasPad(ready && !sandboxed && !drawer)
    if (!drawer) return () => setGameHasPad(false)
    const onMenu = () => closeDrawer()
    window.addEventListener('renplay:pad-menu', onMenu)
    return () => window.removeEventListener('renplay:pad-menu', onMenu)
  }, [drawer, ready, sandboxed, send, closeDrawer])

  const { saveAndFlush } = saving

  const exit = useCallback(async (to: 'library' | 'game' = 'game', anyway = false) => {
    setExiting(true)
    // Saves that did not reach the server stay on this device and go up the next time the game
    // opens here. The person decides whether to leave now.
    if (!anyway && !(await saveAndFlush())) {
      setExiting(false)
      setUnsent(to)
      return
    }
    setUnsent(null)
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    void qc.invalidateQueries({ queryKey: ['saves', gameId] })
    void qc.invalidateQueries({ queryKey: ['games'] })
    navigate(to === 'library' ? '/' : `/game/${gameId}`)
  }, [navigate, qc, send, gameId, saveAndFlush])

  // Defaults that arrive after the game was ready still reach it.
  useEffect(() => {
    if (ready && !sandboxed && defaults.data) send({ type: 'renplay:options', defaults: defaults.data })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sandboxed, defaults.data])

  /** Main menu: the game saves first (saves that cannot reach the server wait on this device), then starts again at its main menu. */
  const mainMenu = async () => {
    setDrawer(null)
    await saveAndFlush()
    setReady(false)
    setProgress(null)
    navigate(`/play/${gameId}`, { replace: true })
    setAttempt((n) => n + 1)
  }

  // Esc on the player itself (not in the game) opens and closes the drawer.
  useEffect(() => {
    if (!ready) return
    const key = (e: KeyboardEvent) => {
      // A key the drawer already used (to close itself) does not open it again.
      if (e.key !== 'Escape' || e.repeat || e.defaultPrevented || escLocked || drawer || guide) return
      openDrawer()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [ready, escLocked, drawer, guide, sandboxed])

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

  if (isLoading)
    return (
      <div className="flex h-dvh items-center justify-center bg-black">
        <Spinner />
      </div>
    )
  if (!online && !keptGame(gameId))
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-black p-6 text-center text-zinc-300">
        <p>You are offline, and this game is not kept in this browser. Keep it offline from its page next time you have a network.</p>
        <Pill onClick={() => navigate('/')}>Go back</Pill>
      </div>
    )
  if (!game || !game.playUrl)
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-black text-zinc-300">
        <p>This game is not installed.</p>
        <Pill onClick={() => navigate(game ? `/game/${gameId}` : '/')}>Go back</Pill>
      </div>
    )

  const loadPct = progress && progress.total ? progress.done / progress.total : 0

  return (
    <div ref={shellRef} className="fixed inset-0 touch-manipulation overflow-hidden overscroll-none bg-black text-white outline-none">
      {signedOut && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center"><section ref={signedOutRef} role="dialog" aria-modal="true" aria-label="You were signed out" className="safe-bottom w-full max-w-md space-y-4 rounded-3xl bg-ink-950 p-6 ring-1 ring-white/10"><h2 className="text-xl font-semibold">You were signed out.</h2><p className="text-sm text-zinc-400">Your saves are kept on this device until you sign in to the same account.</p><Pill variant="p" style={{ display: 'inline-flex' }} href="/signin" target="_blank" rel="noreferrer">Sign in</Pill><Pill className="ml-3" onClick={async () => {
        try { const me = await api<Me>('/api/me'); if (me.user.id !== userId) { setSignInError('Sign in to the account that started this game.'); return }; send({ type: 'renplay:resume-sync', userId }); setSignedOut(false); setSignInError('') } catch { setSignInError('Sign in first, then try again.') }
      }}>Continue</Pill>{signInError && <p role="alert" className="text-sm text-rose-300">{signInError}</p>}</section></div>}
      {/* A click in the bars around the game gives the keyboard back to the game. */}
      <div ref={stageRef} className={cx('rp-stage absolute inset-0', drawer && 'dim')} onPointerDown={(e) => !sandboxed && e.target !== frameRef.current && send({ type: 'renplay:focus' })}>
        <div className="absolute overflow-hidden" style={{ top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left }}>
          <iframe
            ref={frameRef}
            key={attempt}
            src={sandboxed && !htmlSaves.ready ? undefined : game.playUrl}
            title={game.title}
            // A sandboxed frame's origin is opaque: permissions granted to its address alone do not
            // reach it (iPhone Safari then refuses getGamepads, which RPG Maker calls every frame).
            allow={sandboxed ? 'autoplay *; fullscreen *; gamepad *' : 'autoplay; fullscreen; gamepad; clipboard-read; clipboard-write'}
            sandbox={sandboxed ? 'allow-scripts allow-modals allow-pointer-lock allow-popups allow-downloads allow-forms' : undefined}
            className="absolute border-0 bg-black outline-none"
            style={{ width: rect.width || '100%', height: rect.height || '100%', left: rect.left, top: rect.top }}
          />
        </div>
      </div>

      {/* The door: the stage's art grown to the viewport while the game loads. */}
      <Door game={game} ready={ready || (portrait && !portraitOk)} resume={resume} progress={progress} loadPct={loadPct} failed={failed} slow={slow} sandboxed={sandboxed} muted={muted} onMute={toggleMute} fsMode={fsMode} fullscreen={fullscreen} onFullscreen={() => void toggleFullscreen()} onBack={() => (progress ? void exit('game') : navigate(`/game/${gameId}`))} insets={insets} onRetry={() => { setFailed(null); setProgress(null); setAttempt((n) => n + 1) }} onShowGame={() => setReady(true)} />

      {exiting && (
        <div className="absolute inset-0 z-50 flex animate-fade-in flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
          <Loader2 className="size-6 animate-spin text-accent-300" />
          <p className="text-sm text-zinc-200">Saving your progress</p>
        </div>
      )}

      {/* Portrait phones: games are wide. */}
      {portrait && !portraitOk && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/95 p-8 text-center backdrop-blur-sm">
          <Smartphone className="mb-2 size-10 rotate-90 text-accent-300" />
          <p className="text-lg font-semibold">Turn your phone sideways</p>
          <p className="max-w-xs text-sm text-zinc-400">{game.title} is made for a wide screen. The game loads in the meantime.</p>
          {!ready && <div className="mt-4 w-full max-w-xs"><p className="mb-3 text-sm text-zinc-400">{failed || (!progress ? 'Starting engine' : `Loading game ${Math.round(loadPct * 100)}%`)}</p>{failed ? <Pill onClick={() => { setFailed(null); setProgress(null); setAttempt((n) => n + 1) }}>Try again</Pill> : <Bar value={loadPct} indeterminate={!progress || !progress.total} />}</div>}
          <Pill variant="q" size="sm" className="mt-2" onClick={() => setPortraitOk(true)}>
            Play upright anyway
          </Pill>
        </div>
      )}

      {/* Two quiet things over the game: the Renplay pill (the drawer) and, while something waits, the sync pill. */}
      {ready && !drawer && (
        <div
          className={cx('rp-pills', freshPill && 'fresh')}
          // HTML games often put their own menu in the top left (SugarCube's sidebar toggle).
          style={sandboxed ? { top: 10 + Math.max(insets.top, pad.top), right: 10 + insets.right } : { top: 10 + Math.max(insets.top, pad.top), left: 10 + insets.left }}
        >
          <button type="button" className="rp-pill" onClick={openDrawer} aria-label="Open the player menu">
            <span className="mark" aria-hidden="true" />
            Renplay
          </button>
          {fsMode !== 'none' && !fullscreen && (
            <button type="button" className="rp-pill icon" onClick={() => void toggleFullscreen()} aria-label="Full screen">
              <Expand aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {ready && ((sync.pending > 0 && slowSync) || !sync.online) && (
        <span className={cx('rp-sync', !sync.online && 'amber')} role="status" style={sandboxed ? { top: 14 + Math.max(insets.top, pad.top), left: 10 + insets.left } : { top: 14 + Math.max(insets.top, pad.top), right: 10 + insets.right }}>
          {!sync.online ? <CloudOff /> : <RefreshCw className="animate-spin" />}
          {!sync.online ? `Offline, ${sync.pending} ${sync.pending === 1 ? 'save' : 'saves'} waiting` : 'Syncing'}
        </span>
      )}
      {/* A swipe from the left edge opens the drawer on touch screens. */}
      {touch && ready && !drawer && (
        <div
          className="absolute inset-y-0 left-0 z-20 w-4"
          onTouchStart={(e) => {
            const x0 = e.touches[0]!.clientX
            const y0 = e.touches[0]!.clientY
            const done = () => {
              window.removeEventListener('touchend', end)
              window.removeEventListener('touchcancel', done)
            }
            // A swipe mostly to the right opens it. A cancelled touch (the system's own back
            // gesture) does nothing.
            const end = (ev: TouchEvent) => {
              const t = ev.changedTouches[0]
              const dx = (t?.clientX ?? x0) - x0
              const dy = Math.abs((t?.clientY ?? y0) - y0)
              if (dx > 40 && dx > dy * 2) openDrawer()
              done()
            }
            window.addEventListener('touchend', end)
            window.addEventListener('touchcancel', done)
          }}
        />
      )}

      {fullscreen && escLocked && (escHeld || escHint) && <EscapeHint held={escHeld} top={Math.max(insets.top, pad.top) + 60} />}

      <Confirm
        open={unsent !== null}
        onClose={() => setUnsent(null)}
        onConfirm={() => void exit(unsent ?? 'library', true)}
        title="Some saves have not reached the server"
        confirmLabel="Leave anyway"
        cancelLabel="Stay"
      >
        They are kept on this device and go to the server the next time you open this game here. Stay and try Save and exit again, or leave now.
      </Confirm>
      {drawer && (
        <PlayerDrawer
          game={game}
          tab={drawer}
          onTab={setDrawer}
          onClose={closeDrawer}
          portrait={stage.h > stage.w}
          insets={insets}
          renpy={!sandboxed}
          ready={ready}
          pending={sync.pending}
          online={sync.online}
          saving={saving.savingNow}
          onSaveNow={saving.saveNow}
          onExit={(to) => void exit(to)}
          onMainMenu={() => void mainMenu()}
          muted={muted}
          onMute={toggleMute}
          fullscreen={fullscreen}
          onFullscreen={fsMode !== 'none' ? () => void toggleFullscreen() : undefined}
          saves={
            <SavesPanel
              gameId={gameId}
              onLoad={(slot) => {
                send({ type: 'renplay:load', slot })
                setDrawer(null)
              }}
            />
          }
          guide={
            <GuideList
              game={game}
              onOpen={(file) => {
                setGuide(file)
                setDrawer(null)
              }}
            />
          }
          options={
            <div className="stack" style={{ gap: 16 }}>
              <Switch checked={!muted} label="Sound" onChange={() => toggleMute()} />
              {fsMode !== 'none' && (
                <Pill size="sm" icon={fullscreen ? <Shrink className="size-4" /> : <Expand className="size-4" />} onClick={() => void toggleFullscreen()}>
                  {fullscreen ? 'Leave full screen' : 'Full screen'}
                </Pill>
              )}
              {!sandboxed && <GameOptions options={gameOptions} onChange={sendOptions} onAccessibility={() => send({ type: 'renplay:accessibility' })} />}
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
                onDownloadLog={sandboxed ? undefined : () => send({ type: 'renplay:download-log' })}
              />
            </div>
          }
        />
      )}
      {guide && game.walkthroughs.length > 0 && (
        <GuideWindow game={game} file={guide} onFile={setGuide} onClose={() => { setGuide(null); send({ type: 'renplay:focus' }) }} portrait={stage.h > stage.w} insets={insets} />
      )}
      {panel === 'fullscreen' && (
        <SidePanel
          title="Full screen on iPhone"
          onClose={() => setPanel(null)}
          top={pad.top}
          narrow
        >
          <HomeScreenHelp />
        </SidePanel>
      )}
    </div>
  )
}
