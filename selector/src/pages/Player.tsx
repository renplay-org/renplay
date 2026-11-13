import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Smartphone } from 'lucide-react'
import './player/Player.css'
import { GuideWindow, type GuideMode } from '../components/GuideWindow'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Confirm, Spinner, cx, useToast } from '../lantern/ui'
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
import { useDefaults, useGame, useSaves } from '../lib/queries'
import type { Defaults } from '@shared/defaults'
import { keptGame, useOnline } from '../lib/offline'
import { setGameHasPad, useGamepadConnected } from '../lib/gamepad'
import type { Me, SaveSlot } from '@shared/api'
import { isRenpy } from '@shared/family'
import { slotName } from '../lib/format'
import Door from './player/Door'
import { SLOW_SYNC, useSlow } from './player/useSlow'
import { HomeScreenHelp, SidePanel } from './player/panels'
import { useFullscreen } from './player/useFullscreen'
import { useMute } from './player/useMute'
import { useHtmlSaves, useSaving } from './player/useSaving'
import { usePlayTime } from './player/usePlayTime'
import { useTelemetry } from './player/useTelemetry'
import { useElementSize, useSafeInsets, useWakeLock } from './player/useScreen'
import OptionsView, { type GameOptionsState } from './player/OptionsView'
import { PlayerMenu, type MenuView } from './player/PlayerMenu'
import PlayerPill from './player/PlayerPill'
import SavesView from './player/SavesView'
import { useKeyLabels } from './player/keyboard'
import { useGuide } from './player/useGuide'
import { Bar, Pill } from '../lantern/controls'
import { useGoBack } from '../lantern/flight'
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
  // Saves wait for the server: the pill row shows a cloud and the menu says it. The word Offline is for no network at all.
  const waiting = (sync.pending > 0 && slowSync) || !sync.online
  // The menu: closed, or open on its list, Saves or Options.
  const [menu, setMenu] = useState<MenuView | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef(menu)
  menuRef.current = menu
  const toast = useToast()
  const [panel, setPanel] = useState<Panel>(null)
  // The pill and the full screen button are lit for a few seconds after the game is ready, then quiet.
  const [freshPill, setFreshPill] = useState(true)
  const [prefs, setPrefsState] = useState<DisplayPrefs>(loadPrefs)
  const [screenSize, setScreenSize] = useState<[number, number] | null>(null)
  const [exiting, setExiting] = useState(false)
  // Save and exit could not get every save to the server: where the person meant to go.
  const [unsent, setUnsent] = useState<'back' | 'saves' | null>(null)
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
  const openMenu = () => setMenu('top')
  const keys = useKeyLabels()
  const padConnected = useGamepadConnected()
  const saves = useSaves(gameId)

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
  const { fullscreen, coversNotch, escLocked, toggleFullscreen } = useFullscreen(shellRef, fsMode, touch, send, () => setPanel('fullscreen'))
  const stage = useElementSize(stageRef, `${game?.id}:${isLoading}`)
  const upright = stage.h > stage.w
  // The guide: a window beside the menu on a computer, a sheet on an upright phone, the whole screen on one held sideways.
  const guideMode: GuideMode = upright ? 'sheet' : touch && stage.h < 500 ? 'cover' : 'window'
  const guide = useGuide({ game, mode: guideMode, menuOpen: () => !!menuRef.current, leaveMenu: () => setMenu(null), sheetRef, send })
  const guideNow = useRef(guide)
  guideNow.current = guide
  const insets = useSafeInsets()
  useWakeLock(ready)
  usePlayTime(ready && !exiting && !failed, gameId, userId, sandboxed, frameRef, () => setSignedOut(true))
  const telemetry = useTelemetry(gameId, userId, { ready, online, fullscreen, failed })
  // On an iPhone in Safari, once the game has started and never while it loads: once, how to get full screen.
  // It goes the moment the menu opens, so it never lies over a row.
  const dismissTip = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!ready || fsMode !== 'home-screen' || menu || localStorage.getItem(HOME_TIP_KEY)) return
    localStorage.setItem(HOME_TIP_KEY, '1')
    dismissTip.current = toast(
      <>
        For full screen, add Renplay to your home screen.{' '}
        <button className="link" onClick={() => setPanel('fullscreen')}>
          How
        </button>
      </>,
    )
  }, [ready, fsMode, menu, toast])
  useEffect(() => {
    if (menu) dismissTip.current?.()
  }, [menu])

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
          saving.savedNow(d.id, !!d.saved)
          // The new quick save is the first row of the list at once.
          void qc.invalidateQueries({ queryKey: ['saves', gameId] })
          break
        case 'renplay:loaded':
          if (!d.ok) toast('Where you are could not be saved, so nothing was loaded.', 'error')
          else if (d.saved) toast('Loaded. Where you were is saved too.', 'success')
          void qc.invalidateQueries({ queryKey: ['saves', gameId] })
          break
        case 'renplay:save-conflict':
          toast(d.deleted ? 'Another device saved this save after you deleted it here, so it is back.' : 'This save was also changed on another device. Both copies are kept.', 'info')
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
        case 'renplay:perf':
          if (typeof d.fps === 'number') telemetry.fps(d.fps)
          break
        case 'renplay:menu':
          // The controller's Menu button in the game.
          setMenu((view) => view ?? 'top')
          break
        case 'renplay:key':
          if (d.key === 'menu') toggleMenu()
          else if (d.key === 'guide') toggleGuide()
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

  const closeMenu = useCallback(() => {
    setMenu(null)
    send({ type: 'renplay:focus' })
  }, [send])

  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setFreshPill(false), 5000)
    return () => clearTimeout(t)
  }, [ready])

  // The menu has the controller while it is open, and the guide while focus is in it. Their Menu button closes
  // the menu, or opens it from the guide.
  const gameHasPad = !menu && !guide.active
  useEffect(() => {
    if (ready && !sandboxed) send({ type: 'renplay:pads', toGame: gameHasPad })
    setGameHasPad(ready && !sandboxed && gameHasPad)
    if (gameHasPad) return () => setGameHasPad(false)
    const onMenu = () => (menuRef.current ? closeMenu() : openMenu())
    window.addEventListener('renplay:pad-menu', onMenu)
    return () => window.removeEventListener('renplay:pad-menu', onMenu)
  }, [gameHasPad, ready, sandboxed, send, closeMenu])

  const { saveAndFlush } = saving

  const goBack = useGoBack()
  /** Save, wait for the server, and go back to where Play was pressed, or open the game page's Saves. */
  const exit = useCallback(async (to: 'back' | 'saves' = 'back', anyway = false) => {
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
    // Back is one step in the history when Play was pressed in the app, the game page otherwise.
    if (to === 'back' && window.history.state?.idx > 0) goBack()
    else navigate(`/game/${gameId}${to === 'saves' ? '#saves' : ''}`)
  }, [navigate, qc, gameId, saveAndFlush, goBack])

  // Defaults that arrive after the game was ready still reach it.
  useEffect(() => {
    if (ready && !sandboxed && defaults.data) send({ type: 'renplay:options', defaults: defaults.data })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sandboxed, defaults.data])

  // Renplay's keys on the player page: ` opens and closes the menu, \ the guide. In the game they come as messages.
  const busy = useRef(false)
  busy.current = exiting || unsent !== null || signedOut
  const toggleMenu = () => {
    if (busy.current) return
    if (menuRef.current) closeMenu()
    else openMenu()
  }
  const toggleGuide = () => {
    if (!busy.current) guideNow.current.toggle()
  }
  useEffect(() => {
    if (!ready) return
    const key = (e: KeyboardEvent) => {
      const which = e.code === 'Backquote' ? 'menu' : e.code === 'Backslash' || e.code === 'IntlBackslash' ? 'guide' : null
      if (!which || e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      if (e.repeat) return
      if (which === 'menu') toggleMenu()
      else toggleGuide()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, game?.walkthroughs.length])
  // The game's keys: it gives up the backslash when there is no guide.
  useEffect(() => {
    if (ready) send({ type: 'renplay:keys', guide: !!game?.walkthroughs.length })
  }, [ready, game?.walkthroughs.length, send])

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
  // Only before the game is ready: once it runs, losing the network takes nothing away.
  if (!online && !keptGame(gameId) && !ready)
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
  // The door names the save it resumes, "Quick 1", not its slot "quick-1".
  const resumed_ = resume ? (saves.data?.slots.find((x) => slotName(x.file) === resume) ?? (game.latestSave && slotName(game.latestSave.file) === resume ? game.latestSave : null)) : null
  const resumeName = resume ? (resumed_ ? (resumed_ as SaveSlot).title || resumed_.label : resume.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())) : null

  return (
    <div ref={shellRef} className="fixed inset-0 touch-manipulation overflow-hidden overscroll-none bg-black text-white outline-none">
      {signedOut && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 sm:items-center"><section ref={signedOutRef} role="dialog" aria-modal="true" aria-label="You were signed out" className="safe-bottom w-full max-w-md space-y-4 rounded-3xl bg-ink-950 p-6 ring-1 ring-white/10"><h2 className="text-xl font-semibold">You were signed out.</h2><p className="text-sm text-zinc-400">Your saves are kept on this device until you sign in to the same account.</p><Pill variant="p" style={{ display: 'inline-flex' }} href="/signin" target="_blank" rel="noreferrer">Sign in</Pill><Pill className="ml-3" onClick={async () => {
        try { const me = await api<Me>('/api/me'); if (me.user.id !== userId) { setSignInError('Sign in to the account that started this game.'); return }; send({ type: 'renplay:resume-sync', userId }); setSignedOut(false); setSignInError('') } catch { setSignInError('Sign in first, then try again.') }
      }}>Continue</Pill>{signInError && <p role="alert" className="text-sm text-rose-300">{signInError}</p>}</section></div>}
      {/* A click in the bars around the game gives the keyboard back to the game. */}
      <div ref={stageRef} className={cx('rp-stage absolute inset-0', menu && 'dim')} onPointerDown={(e) => !sandboxed && e.target !== frameRef.current && send({ type: 'renplay:focus' })}>
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
      <Door game={game} ready={ready || (portrait && !portraitOk)} resume={resume ? resumeName : null} progress={progress} loadPct={loadPct} failed={failed} slow={slow} sandboxed={sandboxed} muted={muted} onMute={toggleMute} fsMode={fsMode} fullscreen={fullscreen} onFullscreen={() => void toggleFullscreen()} onBack={() => (progress ? void exit() : navigate(`/game/${gameId}`))} insets={insets} onRetry={() => { setFailed(null); setProgress(null); setAttempt((n) => n + 1) }} onShowGame={() => setReady(true)} />

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

      {/* One pill over the game opens the menu. An amber cloud sits beside it while saves wait for the server. */}
      {ready && !menu && (
        <PlayerPill
          style={sandboxed ? { top: 10 + Math.max(insets.top, pad.top), right: 10 + insets.right } : { top: 10 + Math.max(insets.top, pad.top), left: 10 + insets.left }}
          fresh={freshPill}
          pad={padConnected}
          onMenu={openMenu}
          onFullscreen={fsMode !== 'none' && !fullscreen ? () => void toggleFullscreen() : undefined}
          guide={touch && guide.seen && game.walkthroughs.length > 0 ? { open: guide.file !== null, onToggle: guide.toggle, over: guideMode === 'cover' && guide.file !== null } : undefined}
          waiting={waiting}
          waitLabel={online ? 'Some saves have not reached the server yet' : 'Offline. Saves wait on this device'}
        />
      )}
      {/* A swipe from the left edge opens the menu on touch screens. */}
      {touch && ready && !menu && (
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
              if (dx > 40 && dx > dy * 2) openMenu()
              done()
            }
            window.addEventListener('touchend', end)
            window.addEventListener('touchcancel', done)
          }}
        />
      )}

      <Confirm
        open={unsent !== null}
        onClose={() => setUnsent(null)}
        onConfirm={() => void exit(unsent ?? 'back', true)}
        title="Some saves have not reached the server"
        confirmLabel="Leave anyway"
        cancelLabel="Stay"
      >
        They are kept on this device and go to the server the next time you open this game here. Stay and try Save and exit again, or leave now.
      </Confirm>
      {menu && (
        <PlayerMenu
          game={game}
          view={menu}
          onView={setMenu}
          onClose={closeMenu}
          sheetRef={sheetRef}
          portrait={upright}
          insets={insets}
          renpy={!sandboxed}
          ready={ready}
          saveCount={saves.data ? saves.data.slots.filter((x) => x.kind !== 'internal' && x.valid).length : null}
          savedAs={saving.savedAs}
          saving={saving.savingNow}
          onSaveNow={saving.saveNow}
          hasGuide={game.walkthroughs.length > 0}
          guideOpen={guide.file !== null}
          onGuide={guide.open}
          muted={muted}
          onMute={toggleMute}
          fsMode={fsMode}
          fullscreen={fullscreen}
          escLocked={escLocked}
          onFullscreen={() => {
            // On an iPhone the row opens the help sheet, which sits under the menu.
            if (fsMode === 'home-screen') closeMenu()
            void toggleFullscreen()
          }}
          waiting={waiting}
          keys={touch ? null : keys}
          pad={padConnected}
          onExit={() => void exit()}
          saves={
            <SavesView
              game={game}
              onLoad={(slot) => {
                send({ type: 'renplay:save-and-load', slot, id: Math.random().toString(36).slice(2) })
                closeMenu()
              }}
              onManage={() => void exit('saves')}
            />
          }
          options={
            <OptionsView
              renpy={!sandboxed}
              options={gameOptions}
              onChange={sendOptions}
              prefs={prefs}
              setPrefs={setPrefs}
              hasCutout={hasCutout}
              onAccessibility={() => {
                closeMenu()
                send({ type: 'renplay:accessibility' })
              }}
              onDownloadLog={() => send({ type: 'renplay:download-log' })}
            />
          }
        />
      )}
      {guide.file && game.walkthroughs.length > 0 && (
        <GuideWindow game={game} file={guide.file} onFile={guide.setFile} onClose={guide.close} mode={guideMode} insets={insets} after={guide.after} focusToken={guide.focusToken} onActive={guide.setActive} onPark={guide.park} />
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
