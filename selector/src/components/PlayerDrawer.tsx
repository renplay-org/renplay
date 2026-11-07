import { BookOpen, ExternalLink, Maximize2, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Frame } from '../lantern/art'
import { Pill, Seg } from '../lantern/controls'
import type { Game } from '../lib/api'

export type DrawerTab = 'saves' | 'guide' | 'options'
type Walkthrough = Game['walkthroughs'][number]

/**
 * The player's one drawer (DESIGN 2.4): from the left, a sheet from the bottom on a portrait
 * phone. The icon and title, three tabs, and a footer with Save now as a plate, Save and exit as
 * the one primary, a line on what happens to saves that have not synced, and the other ways out.
 * Rendered only while open, so nothing in it can take focus while it is closed.
 */
export function PlayerDrawer({
  game,
  tab,
  onTab,
  onClose,
  portrait,
  insets,
  renpy,
  ready,
  pending,
  online,
  saving,
  onSaveNow,
  onExit,
  onMainMenu,
  saves,
  guide,
  options,
}: {
  game: Game
  tab: DrawerTab
  onTab: (tab: DrawerTab) => void
  onClose: () => void
  portrait: boolean
  insets: { top: number; right: number; bottom: number; left: number }
  renpy: boolean
  ready: boolean
  pending: number
  online: boolean
  saving: boolean
  onSaveNow: () => void
  onExit: (to: 'library' | 'game') => void
  onMainMenu: () => void
  saves: ReactNode
  guide: ReactNode
  options: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The newest onClose, without running the effect below again: the player re-renders often (each
  // sync report), and focus must stay where the person is.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const opener = document.activeElement
    ref.current?.querySelector<HTMLElement>('[data-initial]')?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
        return
      }
      // Tab stays in the drawer while it is open.
      if (e.key !== 'Tab' || !ref.current) return
      const items = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null)
      if (!items.length) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const inside = ref.current.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  const tabs = [
    ...(renpy ? [{ value: 'saves' as const, label: 'Saves' }] : []),
    { value: 'guide' as const, label: 'Guide' },
    { value: 'options' as const, label: 'Options' },
  ]
  const waiting = pending > 0 || !online
  return (
    <>
      <div className="pd-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${game.title}, the player menu`}
        className={`pdrawer ${portrait ? 'bottom' : ''}`}
        style={portrait ? { paddingBottom: 16 + insets.bottom, paddingLeft: 16 + insets.left, paddingRight: 16 + insets.right } : { paddingTop: 16 + insets.top, paddingLeft: 16 + insets.left, paddingBottom: 16 + insets.bottom }}
      >
        <header className="pd-head">
          <Frame game={game} kind="sq" className="pd-icon" style={{ flex: 'none' }} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="truncate" style={{ fontWeight: 700, fontSize: 17 }}>{game.title}</div>
            {game.version && <div className="xs muted truncate">{game.version}</div>}
          </div>
          <button type="button" className="ib" aria-label="Back to the game" onClick={onClose} data-initial>
            <X />
          </button>
        </header>
        <Seg small label="Player menu" value={tab} onChange={onTab} options={tabs} className="pd-tabs" />
        <div className="pd-body">{tab === 'saves' ? saves : tab === 'guide' ? guide : options}</div>
        <footer className="pd-foot">
          <div className="actions">
            {renpy && ready && (
              <Pill variant="s" onClick={onSaveNow} aria-disabled={saving}>
                {saving ? 'Saving' : 'Save now'}
              </Pill>
            )}
            <Pill variant="p" onClick={() => onExit('library')}>
              Save and exit
            </Pill>
          </div>
          <p className={`xs muted pd-hint ${waiting ? 'waiting' : ''}`}>
            Leaving saves first.
            {pending > 0
              ? ` ${pending} ${pending === 1 ? 'save is' : 'saves are'} waiting on this device and ${pending === 1 ? 'syncs' : 'sync'} when the connection is back.`
              : !online
                ? ' You are offline. New saves wait on this device until the connection is back.'
                : ''}
          </p>
          <div className="pd-links">
            {renpy && ready && (
              <button type="button" className="link small" onClick={onMainMenu}>
                Main menu
              </button>
            )}
            <button type="button" className="link small" onClick={() => onExit('game')}>
              Game page
            </button>
          </div>
        </footer>
      </aside>
    </>
  )
}

/** The Guide tab: the walkthrough files and the catalog's guide. */
export function GuideList({ game, onOpen }: { game: Game; onOpen: (file: string) => void }) {
  const files = game.walkthroughs
  return (
    <div className="stack" style={{ gap: 8 }}>
      {files.length === 0 && <p className="small muted">No walkthrough for this game yet. An admin can add one on the game’s page, under Walkthroughs.</p>}
      {files.map((w) => (
        <button key={w.file} type="button" className="pd-row" onClick={() => onOpen(w.file)}>
          <BookOpen />
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="truncate" style={{ display: 'block', fontWeight: 600 }}>{w.title}</span>
            <span className="xs muted">{{ pdf: 'PDF', image: 'Picture', text: 'Text' }[w.kind]}</span>
          </span>
        </button>
      ))}
      {game.recipe?.links.walkthrough && (
        <a className="pd-row" href={game.recipe.links.walkthrough} target="_blank" rel="noreferrer">
          <ExternalLink />
          <span className="grow">
            <span style={{ display: 'block', fontWeight: 600 }}>The guide the catalog links</span>
            <span className="xs muted">Opens in a new tab</span>
          </span>
        </a>
      )}
    </div>
  )
}

function Reader({ w }: { w: Walkthrough }) {
  if (w.kind === 'image')
    return (
      <div className="gw-img">
        <img src={w.url} alt={w.title} />
      </div>
    )
  // iPhone and iPad Safari draw only a PDF's first page in a frame: there it opens in its own tab.
  if (w.kind === 'pdf' && /iPhone|iPad|iPod/.test(navigator.userAgent + (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) ? ' iPad' : '')))
    return (
      <div className="gw-img stack" style={{ gap: 12, alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <p className="small muted">This browser shows only the first page of a PDF here.</p>
        <Pill variant="p" href={w.url} target="_blank" rel="noopener">
          Open the PDF
        </Pill>
      </div>
    )
  return <iframe src={w.url} title={w.title} className="gw-frame" />
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The walkthrough beside the game. A floating window on desktop and in landscape: drag it by its
 * title, resize it from the 44 px grip, a tab per file, see-through, pop it out. It stays inside
 * the safe viewport and never takes focus from the game unless tapped. On a portrait phone, a
 * reading sheet over the lower part of the screen with Back to the game.
 */
export function GuideWindow({ game, file, onFile, onClose, portrait, insets }: { game: Game; file: string; onFile: (file: string) => void; onClose: () => void; portrait: boolean; insets: { top: number; right: number; bottom: number; left: number } }) {
  const files = game.walkthroughs
  const current = files.find((w) => w.file === file) ?? files[0]
  const [opacity, setOpacity] = useState('1')
  const bounds = () => ({ left: insets.left + 8, top: insets.top + 8, right: window.innerWidth - insets.right - 8, bottom: window.innerHeight - insets.bottom - 8 })
  const [box, setBox] = useState<Box>(() => {
    const b = bounds()
    const w = Math.min(460, (b.right - b.left) * 0.42)
    const h = Math.min(640, (b.bottom - b.top) * 0.82)
    return { x: b.right - w, y: b.top + 48, w, h }
  })
  const clamp = (n: Box): Box => {
    const b = bounds()
    const w = Math.max(260, Math.min(n.w, b.right - b.left))
    const h = Math.max(200, Math.min(n.h, b.bottom - b.top))
    return { w, h, x: Math.min(Math.max(n.x, b.left), b.right - w), y: Math.min(Math.max(n.y, b.top), b.bottom - h) }
  }
  useEffect(() => {
    const fit = () => setBox((b) => clamp(b))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets.top, insets.right, insets.bottom, insets.left])
  const drag = (mode: 'move' | 'size') => (e: ReactPointerEvent) => {
    if (mode === 'move' && (e.target as HTMLElement).closest('button, a, input, select')) return
    e.preventDefault()
    const start = { px: e.clientX, py: e.clientY, ...box }
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px
      const dy = ev.clientY - start.py
      setBox(clamp(mode === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy }))
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }
  if (!current) return null
  const tabs = files.length > 1 && (
    <div className="gw-tabs" role="tablist" aria-label="Walkthroughs">
      {files.map((w) => (
        <button key={w.file} type="button" role="tab" aria-selected={w.file === current.file} className={w.file === current.file ? 'on' : ''} onClick={() => onFile(w.file)}>
          {w.title}
        </button>
      ))}
    </div>
  )
  if (portrait)
    return (
      <section className="gw-sheet" aria-label={`Walkthrough, ${current.title}`} style={{ paddingBottom: insets.bottom }}>
        <div className="gw-bar">
          <Pill variant="s" size="sm" onClick={onClose}>
            Back to the game
          </Pill>
          <span className="grow" />
          <a className="ib" href={current.url} target="_blank" rel="noreferrer" aria-label="Open in a new tab">
            <Maximize2 />
          </a>
        </div>
        {tabs}
        <Reader w={current} />
      </section>
    )
  return (
    <section className="gw" aria-label={`Walkthrough, ${current.title}`} style={{ left: box.x, top: box.y, width: box.w, height: box.h, opacity: Number(opacity) }}>
      <div className="gw-bar" onPointerDown={drag('move')}>
        <span className="truncate grow" style={{ fontWeight: 650, fontSize: 13.5 }}>{current.title}</span>
        <Seg small label="See-through" value={opacity} onChange={setOpacity} options={[{ value: '1', label: 'Solid' }, { value: '0.85', label: '85%' }, { value: '0.7', label: '70%' }]} />
        <a className="ib" href={current.url} target="_blank" rel="noreferrer" aria-label="Pop out into a new tab">
          <ExternalLink />
        </a>
        <button type="button" className="ib" aria-label="Close the walkthrough" onClick={onClose}>
          <X />
        </button>
      </div>
      {tabs}
      <Reader w={current} />
      <div className="gw-grip" onPointerDown={drag('size')} role="separator" aria-label="Resize the walkthrough" />
    </section>
  )
}
