import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Check, CloudOff, Expand, Play, Save, Settings2, Smartphone, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { Game } from '@shared/api'
import { Frame } from '../../lantern/art'
import { Pill } from '../../lantern/controls'
import { Keycap } from '../../lantern/Keycap'
import { useModal } from '../../lantern/modal'
import { cx } from '../../lantern/ui'
import { popupClick } from '../../lib/links'

/** The list, Saves or Options. */
export type MenuView = 'top' | 'saves' | 'options'

/** A row with a switch: the whole row is the button, so the target is as tall as the row. */
export function SwitchRow({ icon, label, checked, onChange }: { icon?: ReactNode; label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="pm-row" onClick={() => onChange(!checked)}>
      {icon}
      <span>{label}</span>
      <span className={cx('sw', checked && 'on')} aria-hidden="true" />
    </button>
  )
}

/**
 * The player's menu as one list: Back to the game, Save now, Guide, Saves, Options, Sound and Full screen,
 * then Save and exit. Saves and Options open in place with a Back row. The guide opens beside the sheet and the
 * menu stays, or on a phone takes its place. A sheet from the left, from the bottom on a portrait phone.
 * Rendered only while open, so nothing in it can take focus while it is closed.
 */
export function PlayerMenu({
  game,
  view,
  onView,
  onClose,
  sheetRef,
  portrait,
  insets,
  renpy,
  ready,
  saveCount,
  savedAs,
  saving,
  onSaveNow,
  hasGuide,
  guideOpen,
  onGuide,
  muted,
  onMute,
  fsMode,
  fullscreen,
  escLocked,
  onFullscreen,
  waiting,
  keys,
  pad,
  onExit,
  saves,
  options,
}: {
  game: Game
  view: MenuView
  onView: (view: MenuView) => void
  onClose: () => void
  /** The sheet, for the guide beside it to find its edge. */
  sheetRef: RefObject<HTMLDivElement | null>
  portrait: boolean
  insets: { top: number; right: number; bottom: number; left: number }
  renpy: boolean
  ready: boolean
  /** The saves list's length, shown on the Saves row. */
  saveCount: number | null
  /** The name Save now just saved under, for three seconds. */
  savedAs: string | null
  saving: boolean
  onSaveNow: () => void
  /** The game has a walkthrough file: its row opens the guide. A guide the catalog links is a link row instead. */
  hasGuide: boolean
  /** The guide window is open beside the sheet: its row hands focus to it. */
  guideOpen: boolean
  onGuide: () => void
  muted: boolean
  onMute: () => void
  fsMode: 'api' | 'home-screen' | 'none'
  fullscreen: boolean
  /** Esc is kept for the game in full screen, so leaving takes a hold. */
  escLocked: boolean
  onFullscreen: () => void
  /** Saves wait on this device until the server can be reached. */
  waiting: boolean
  /** The key line for a keyboard, or null where there is none (a touch screen). */
  keys: { menu: string; guide: string } | null
  pad: boolean
  onExit: () => void
  saves: ReactNode
  options: ReactNode
}) {
  const ref = sheetRef
  // Escape goes back to the list first and closes from the list. Not inert: the menu is part of the player's page.
  useModal(ref, true, view === 'top' ? onClose : () => onView('top'))
  // A list opening in place takes focus with it: the Back row, which Enter, A and the arrows reach first.
  // Closing the guide beside the sheet gives focus back to the Guide row.
  const opened = useRef({ view, guideOpen })
  useEffect(() => {
    const before = opened.current
    opened.current = { view, guideOpen }
    const at = (selector: string) => ref.current?.querySelector<HTMLElement>(selector)?.focus()
    if (before.guideOpen && !guideOpen && view === 'top') at('[data-guide]')
    else if (before.view !== view) at('[data-initial]')
  }, [view, guideOpen, ref])
  const link = game.recipe?.links.walkthrough
  // The safe areas of the screen, which the sheet's padding adds to its own.
  const sheet = { '--pi-top': `${insets.top}px`, '--pi-right': `${insets.right}px`, '--pi-bottom': `${insets.bottom}px`, '--pi-left': `${insets.left}px` } as CSSProperties
  return (
    <>
      <div className="pm-scrim" onClick={onClose} aria-hidden="true" />
      <aside ref={ref} role="dialog" aria-modal="true" aria-label={`${game.title}, the player menu`} className={cx('pm', portrait && 'bottom')} data-view={view} style={sheet}>
        <header className="pm-head">
          <Frame game={game} kind="sq" className="pm-icon" style={{ flex: 'none' }} />
          <div className="pm-title truncate">{game.title}</div>
        </header>
        <div className="pm-body">
          {view !== 'top' ? (
            <>
              <button type="button" className="pm-row first" onClick={() => onView('top')} data-initial>
                <ChevronLeft />
                Back
              </button>
              {view === 'saves' ? saves : options}
            </>
          ) : (
            <>
              <button type="button" className="pm-row first" onClick={onClose} data-initial>
                <ArrowLeft />
                Back to the game
                {keys && !pad && (
                  <span className="pm-end">
                    <Keycap char={keys.menu} />
                  </span>
                )}
              </button>
              {renpy && ready && (
                <button type="button" className="pm-row" onClick={onSaveNow} aria-disabled={saving}>
                  <Save />
                  {saving ? 'Saving' : 'Save now'}
                  {savedAs && (
                    <span className="pm-end done" role="status">
                      {savedAs}
                      <Check aria-hidden="true" />
                    </span>
                  )}
                </button>
              )}
              {hasGuide ? (
                <button type="button" className="pm-row" onClick={onGuide} data-guide aria-expanded={guideOpen}>
                  <BookOpen />
                  Guide
                  {keys && !pad && (
                    <span className="pm-end">
                      <Keycap char={keys.guide} />
                    </span>
                  )}
                </button>
              ) : (
                link && (
                  <a className="pm-row" href={link} target="_blank" rel="noreferrer" onClick={popupClick(link)}>
                    <BookOpen />
                    Guide
                  </a>
                )
              )}
              {renpy && (
                <button type="button" className="pm-row" onClick={() => onView('saves')}>
                  <Play />
                  Saves
                  <span className="pm-end">
                    {saveCount ?? game.saves.count}
                    <ChevronRight />
                  </span>
                </button>
              )}
              <button type="button" className="pm-row" onClick={() => onView('options')}>
                <Settings2 />
                Options
                <span className="pm-end">
                  <ChevronRight />
                </span>
              </button>
              <div className="pm-switches">
                <SwitchRow icon={muted ? <VolumeX /> : <Volume2 />} label="Sound" checked={!muted} onChange={onMute} />
                {fsMode === 'home-screen' ? (
                  <button type="button" className="pm-row" onClick={onFullscreen}>
                    <Smartphone />
                    <span>
                      Full screen<span className="pm-wide"> on iPhone</span>
                    </span>
                    <span className="pm-end">
                      <ChevronRight />
                    </span>
                  </button>
                ) : (
                  fsMode === 'api' && <SwitchRow icon={<Expand />} label="Full screen" checked={fullscreen} onChange={onFullscreen} />
                )}
              </div>
              {fullscreen && escLocked && <p className="pm-note">Hold Esc to leave</p>}
            </>
          )}
        </div>
        {view === 'top' && (
          <footer className="pm-foot">
            {waiting && (
              <p className="pm-wait" role="status">
                <CloudOff aria-hidden="true" />
                Some saves have not reached the server yet. They go up when it is back.
              </p>
            )}
            <Pill variant="p" className="pm-exit" onClick={onExit}>
              Save and exit
            </Pill>
            {pad ? (
              <p className="pm-keys">A select, B back</p>
            ) : (
              keys && (
                <p className="pm-keys">
                  <Keycap char={keys.menu} /> opens this menu{hasGuide ? <>, <Keycap char={keys.guide} /> the guide</> : null}
                </p>
              )
            )}
          </footer>
        )}
      </aside>
    </>
  )
}
