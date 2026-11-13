import { ExternalLink, Maximize2, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Pill, Seg, IconBtn } from '../lantern/controls'
import type { Game } from '@shared/api'
import { isAppleTouch } from '../lib/platform'
import { useModal } from '../lantern/modal'

type Walkthrough = Game['walkthroughs'][number]

function Reader({ w }: { w: Walkthrough }) {
  if (w.kind === 'image')
    return (
      <div className="gw-img">
        <img src={w.url} alt={w.title} />
      </div>
    )
  // iPhone and iPad Safari draw only a PDF's first page in a frame: there it opens in its own tab.
  if (w.kind === 'pdf' && isAppleTouch())
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

/** The tabs of the walkthrough's files, when there are several, over the file itself. Fills the space it is given. */
export function GuideReader({ game, file, onFile }: { game: Game; file: string; onFile: (file: string) => void }) {
  const files = game.walkthroughs
  const current = files.find((w) => w.file === file) ?? files[0]
  if (!current) return null
  return (
    <>
      {files.length > 1 && (
        <div className="gw-tabs" role="tablist" aria-label="Walkthroughs">
          {files.map((w) => (
            <button key={w.file} type="button" role="tab" aria-selected={w.file === current.file} className={w.file === current.file ? 'on' : ''} onClick={() => onFile(w.file)}>
              {w.title}
            </button>
          ))}
        </div>
      )}
      <Reader w={current} />
    </>
  )
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
 *
 * `after` is the right edge of the menu's sheet when the window opens beside it: it starts just to
 * the right of that, never under it. `modal` is while the menu is open and the window was opened from
 * it: focus goes into the window, Tab stays in it and Escape closes it.
 */
export function GuideWindow({ game, file, onFile, onClose, portrait, insets, after, modal }: { game: Game; file: string; onFile: (file: string) => void; onClose: () => void; portrait: boolean; insets: { top: number; right: number; bottom: number; left: number }; after?: number; modal: boolean }) {
  const files = game.walkthroughs
  const current = files.find((w) => w.file === file) ?? files[0]
  const [opacity, setOpacity] = useState('1')
  const bounds = () => ({ left: insets.left + 8, top: insets.top + 8, right: window.innerWidth - insets.right - 8, bottom: window.innerHeight - insets.bottom - 8 })
  const [box, setBox] = useState<Box>(() => {
    const b = bounds()
    const h = Math.min(640, (b.bottom - b.top) * 0.82)
    if (after !== undefined) {
      const x = after + 12
      return { x, y: b.top + 48, w: Math.max(260, Math.min(460, b.right - x)), h }
    }
    const w = Math.min(460, (b.right - b.left) * 0.42)
    return { x: b.right - w, y: b.top + 48, w, h }
  })
  const windowRef = useRef<HTMLElement>(null)
  useModal(windowRef, modal && !portrait, onClose)
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
  if (portrait)
    return (
      <section className="gw-sheet" aria-label={`Walkthrough, ${current.title}`} style={{ paddingBottom: insets.bottom }}>
        <div className="gw-bar">
          <Pill variant="s" size="sm" onClick={onClose}>
            Back to the game
          </Pill>
          <span className="grow" />
          <IconBtn label="Open in a new tab" href={current.url} target="_blank" rel="noreferrer">
            <Maximize2 />
          </IconBtn>
        </div>
        <GuideReader game={game} file={file} onFile={onFile} />
      </section>
    )
  return (
    <section ref={windowRef} tabIndex={-1} className="gw" aria-label={`Walkthrough, ${current.title}`} style={{ left: box.x, top: box.y, width: box.w, height: box.h, opacity: Number(opacity) }}>
      <div className="gw-bar" onPointerDown={drag('move')}>
        <span className="truncate grow" style={{ fontWeight: 650, fontSize: 13.5 }}>{current.title}</span>
        <Seg small label="See-through" value={opacity} onChange={setOpacity} options={[{ value: '1', label: 'Solid' }, { value: '0.85', label: '85%' }, { value: '0.7', label: '70%' }]} />
        <IconBtn label="Pop out into a new tab" href={current.url} target="_blank" rel="noreferrer">
          <ExternalLink />
        </IconBtn>
        <IconBtn label="Close the walkthrough" onClick={onClose} data-initial>
          <X />
        </IconBtn>
      </div>
      <GuideReader game={game} file={file} onFile={onFile} />
      <div className="gw-grip" onPointerDown={drag('size')} role="separator" aria-label="Resize the walkthrough" />
    </section>
  )
}
