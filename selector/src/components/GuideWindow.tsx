import { Eye, PictureInPicture2, Undo2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Game } from '@shared/api'
import { IconBtn, Pill } from '../lantern/controls'
import { useModal } from '../lantern/modal'
import { deviceKind } from '../lib/platform'
import { keep, keptSeeThrough, keepFile } from './guide/keep'
import { GuideReader, type ReaderHandle } from './guide/Reader'
import { useBox } from './guide/useBox'
import { usePopout } from './guide/usePopout'
import './guide/Guide.css'

/** A window over the game, a sheet from the bottom of an upright phone, or the whole screen of one held sideways. */
export type GuideMode = 'window' | 'sheet' | 'cover'

/** What the controller sends the guide while it holds the pad (renplay:guide-pad, from lib/gamepad.ts). */
type GuidePadInput = 'up' | 'down' | 'left' | 'right' | 'lb' | 'rb' | 'x' | 'y' | 'b'

/** The window's see-through is the game showing through at this much. */
const SEE_THROUGH = 0.7

/** The sheet's two heights, as a share of the screen. */
const SHEET = { short: 58, tall: 92 }

type Insets = { top: number; right: number; bottom: number; left: number }

/**
 * The walkthrough beside the game. A floating window on a computer: drag it by its title, resize it from the 44 px
 * grip, a tab per file, see-through, pop it out into a window of its own. On an upright phone a sheet from the
 * bottom with a handle and two heights, on one held sideways the whole screen, both with Back to the game first.
 * It is a layer beside the game, not a trap: Escape and the backslash close it while focus is in it, and the
 * controller's buttons are its own while it has focus (the pad goes to the game again when it is parked).
 *
 * `after` is the right edge of the menu's sheet when the window opens beside it: it starts just to the right of
 * that, never under it. `focusToken` changes each time the guide is asked for by the keyboard, the controller or the
 * menu: focus goes into it. `onActive` says whether focus is in it, which is when it holds the pad.
 */
export function GuideWindow({ game, file, onFile, onClose, mode, insets, after, focusToken, onActive, onPark }: { game: Game; file: string; onFile: (file: string) => void; onClose: () => void; mode: GuideMode; insets: Insets; after?: number; focusToken: number; onActive: (active: boolean) => void; onPark: () => void }) {
  const files = game.walkthroughs
  const current = files.find((w) => w.file === file) ?? files[0]
  const [seeThrough, setSeeThrough] = useState(keptSeeThrough)
  const toggleSeeThrough = useCallback(() => {
    setSeeThrough((on) => {
      keep({ seeThrough: !on })
      return !on
    })
  }, [])
  const { box, drag } = useBox(insets, after)
  const [tall, setTall] = useState(false)
  const windowRef = useRef<HTMLElement>(null)
  const reader = useRef<ReaderHandle | null>(null)
  const boxNow = useRef(box)
  boxNow.current = box
  const size = useCallback(() => ({ w: boxNow.current.w, h: boxNow.current.h }), [])
  const popout = usePopout(`/guide/${game.id}/${encodeURIComponent(file)}`, size)
  const popped = popout.out?.kind === 'window' ? popout.out.win : null
  const away = popout.out !== null
  useModal(windowRef, !away, onClose, { trap: false })

  // In a window of its own the guide has no focus here: the controller is the game's again.
  useEffect(() => {
    if (away) onActive(false)
  }, [away, onActive])

  // Asked for, so focus goes in. The reader is what takes the keys.
  useEffect(() => {
    if (focusToken && !away) (windowRef.current?.querySelector<HTMLElement>('[data-reader]') ?? windowRef.current)?.focus({ preventScroll: true })
  }, [focusToken, away])

  // The controller's own buttons, while focus is in the guide.
  useEffect(() => {
    const press = (e: Event) => {
      const input = (e as CustomEvent<GuidePadInput>).detail
      const at = files.findIndex((w) => w.file === file)
      const switchTo = (step: number) => {
        const next = files[(at + step + files.length) % files.length]
        if (next && next.file !== file) (keepFile(game, next.file), onFile(next.file))
      }
      if (input === 'up' || input === 'down') reader.current?.scroll(0, input === 'up' ? -56 : 56)
      else if (input === 'left' || input === 'right') reader.current?.page(input === 'left' ? -1 : 1)
      else if (input === 'lb' || input === 'rb') switchTo(input === 'lb' ? -1 : 1)
      else if (input === 'x') reader.current?.cycle()
      else if (input === 'y') toggleSeeThrough()
      else if (input === 'b') onPark()
    }
    window.addEventListener('renplay:guide-pad', press)
    return () => window.removeEventListener('renplay:guide-pad', press)
  }, [files, file, game, onFile, onPark, toggleSeeThrough])

  if (!current) return null
  const label = `Walkthrough, ${current.title}`
  // The tabs name the files when there are several, so the title is the game's.
  const heading = files.length > 1 ? game.title : current.title
  const focusEvents = {
    onFocus: () => onActive(true),
    onBlur: (e: { currentTarget: HTMLElement; relatedTarget: EventTarget | null }) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onActive(false)
    },
  }
  const body = <GuideReader game={game} file={file} onFile={onFile} handle={reader} />
  const back = (
    <Pill variant="s" size="sm" onClick={onClose}>
      Back to the game
    </Pill>
  )

  if (mode === 'sheet') {
    // A drag of the handle up or down chooses the height, and a tap on it switches. From the keyboard it is a click.
    const resize = (e: ReactPointerEvent) => {
      const y0 = e.clientY
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      const up = (ev: PointerEvent) => {
        target.removeEventListener('pointerup', up)
        const dy = ev.clientY - y0
        setTall(Math.abs(dy) < 8 ? (t) => !t : dy < 0)
      }
      target.addEventListener('pointerup', up)
    }
    return (
      <section ref={windowRef} role="dialog" aria-label={label} tabIndex={-1} className="gw-sheet" data-guide-window="" style={{ height: `${tall ? SHEET.tall : SHEET.short}dvh`, paddingBottom: insets.bottom }} {...focusEvents}>
        <div className="gw-bar">
          {back}
          <span className="grow" />
        </div>
        <button type="button" className="gw-handle" aria-label={tall ? 'Make the guide shorter' : 'Make the guide taller'} onPointerDown={resize} onClick={(e) => e.detail === 0 && setTall((t) => !t)}>
          <span />
        </button>
        {body}
      </section>
    )
  }
  if (mode === 'cover')
    return (
      <section ref={windowRef} role="dialog" aria-label={label} tabIndex={-1} className="gw-cover" data-guide-window="" style={{ paddingTop: insets.top, paddingRight: insets.right, paddingBottom: insets.bottom, paddingLeft: insets.left }} {...focusEvents}>
        <div className="gw-bar">
          <span className="gw-pills" aria-hidden="true" />
          <span className="truncate grow" style={{ fontWeight: 650, fontSize: 13.5 }}>
            {heading}
          </span>
          {back}
        </div>
        {body}
      </section>
    )

  const phone = deviceKind() === 'phone'
  const frame = (inside: ReactNode, style?: object) => (
    <section ref={popped ? undefined : windowRef} role="dialog" aria-label={label} tabIndex={-1} className="gw" data-guide-window="" style={style} {...focusEvents}>
      {inside}
    </section>
  )
  const bar = (
    <div className="gw-bar" onPointerDown={popped ? undefined : drag('move')}>
      <span className="truncate grow" style={{ fontWeight: 650, fontSize: 13.5 }}>
        {heading}
      </span>
      {!popped && (
        <IconBtn label="See-through" aria-pressed={seeThrough} onClick={toggleSeeThrough}>
          <Eye />
        </IconBtn>
      )}
      {!phone &&
        (popped ? (
          <IconBtn label="Bring back" onClick={popout.bringBack}>
            <Undo2 />
          </IconBtn>
        ) : (
          <IconBtn label="Pop out" onClick={() => void popout.open()}>
            <PictureInPicture2 />
          </IconBtn>
        ))}
      <IconBtn label="Close the walkthrough" onClick={onClose}>
        <X />
      </IconBtn>
    </div>
  )
  // Out in a Picture-in-Picture window the reader is moved there. Out in a popup it is the popup's page that reads.
  if (popped) return createPortal(frame(<>{bar}{body}</>, { position: 'static', width: '100%', height: '100%' }), popped.document.body)
  if (away) return null
  return frame(
    <>
      {bar}
      {body}
      <div className="gw-grip" onPointerDown={drag('size')} role="separator" aria-label="Resize the walkthrough" />
    </>,
    { left: box.x, top: box.y, width: box.w, height: box.h, opacity: seeThrough ? SEE_THROUGH : 1 },
  )
}
