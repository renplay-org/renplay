import { Accessibility, Camera, Download, FastForward, PanelTop, Terminal, Undo2 } from 'lucide-react'
import { TEXT_SIZES } from '@shared/defaults'
import { Seg, SourceLabel } from '../../lantern/controls'
import type { DisplayPrefs } from '../../lib/display'
import { SwitchRow } from './PlayerMenu'

/** A Ren'Py game's options for this person, as the game reports them. */
export interface GameOptionsState {
  patches: { rollback?: boolean; skip?: boolean; console?: boolean }
  fontSize: number
  /** Whose choice it is: the person's, the admin's default for everyone, or Renplay's. */
  patchesFrom: string
  sizeFrom: string
}

/**
 * The Options view. Ren'Py games: text size, picture, the camera cutout, rollback and skip, the game's
 * accessibility screen, the console, the log. HTML games: picture and the camera cutout only.
 */
export default function OptionsView({
  renpy,
  options,
  onChange,
  prefs,
  setPrefs,
  hasCutout,
  onAccessibility,
  onDownloadLog,
  keepButtons,
}: {
  renpy: boolean
  options: GameOptionsState | null
  onChange: (change: Record<string, unknown>) => void
  prefs: DisplayPrefs
  setPrefs: (p: DisplayPrefs) => void
  hasCutout: boolean
  onAccessibility: () => void
  onDownloadLog: () => void
  /** Layout 3's choice to keep its buttons on the screen. */
  keepButtons?: { value: boolean; onChange: (keep: boolean) => void }
}) {
  const fromAdmin = options?.patchesFrom === 'admin'
  return (
    <>
      {renpy && options && (
        <div className="pm-field">
          <span>Text size</span>
          <Seg label="Text size" value={String(TEXT_SIZES.find((t) => Math.abs(t.value - options.fontSize) < 0.01)?.value ?? '')} onChange={(v) => onChange({ fontSize: Number(v) })} options={TEXT_SIZES.map((t) => ({ value: String(t.value), label: t.label }))} />
          {options.sizeFrom === 'admin' && <SourceLabel kind="admin" />}
        </div>
      )}
      <div className="pm-field">
        <span>Picture</span>
        <Seg label="Picture" value={prefs.fit} onChange={(fit) => setPrefs({ ...prefs, fit })} options={[{ value: 'fit', label: 'Fit' }, { value: 'fill', label: 'Fill' }]} />
      </div>
      {keepButtons && <SwitchRow icon={<PanelTop />} label="Keep buttons on screen" checked={keepButtons.value} onChange={keepButtons.onChange} />}
      {hasCutout && <SwitchRow icon={<Camera />} label="Keep clear of the camera" checked={prefs.avoidNotch} onChange={(avoidNotch) => setPrefs({ ...prefs, avoidNotch })} />}
      {renpy && options && (
        <>
          <SwitchRow icon={<Undo2 />} label="Rollback even where the game turns it off" checked={!!options.patches.rollback} onChange={(rollback) => onChange({ patches: { rollback } })} />
          <SwitchRow icon={<FastForward />} label="Skip even where the game turns it off" checked={!!options.patches.skip} onChange={(skip) => onChange({ patches: { skip } })} />
          {fromAdmin && <div className="pm-note"><SourceLabel kind="admin" /></div>}
        </>
      )}
      {renpy && (
        <>
          <button type="button" className="pm-row" onClick={onAccessibility}>
            <Accessibility />
            The game’s accessibility screen
          </button>
          <hr className="pm-rule" />
          {options && <SwitchRow icon={<Terminal />} label="Developer console" checked={!!options.patches.console} onChange={(console) => onChange({ patches: { console } })} />}
          <button type="button" className="pm-row quiet" onClick={onDownloadLog}>
            <Download />
            Download the game’s log
          </button>
        </>
      )}
    </>
  )
}
