import { Seg, SourceLabel, Pill } from '../../lantern/controls'
import { Switch } from '../../lantern/ui'
import { TEXT_SIZES } from '@shared/defaults'

/** A Ren'Py game's options for this person, as the game reports them. */
export interface GameOptionsState {
  patches: { rollback?: boolean; skip?: boolean; console?: boolean }
  fontSize: number
  /** Whose choice it is: the person's, the admin's default for everyone, or Renplay's. */
  patchesFrom: string
  sizeFrom: string
}

/** The text size, Ren'Py's accessibility menu and this person's patches, in the player's options. */
export default function GameOptions({ options, onChange, onAccessibility }: { options: GameOptionsState | null; onChange: (change: Record<string, unknown>) => void; onAccessibility: () => void }) {
  return (
    <>
      {options && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row between" style={{ gap: 8 }}>
            <span className="small" style={{ fontWeight: 600 }}>Text size</span>
            {options.sizeFrom === 'admin' && <SourceLabel kind="admin" />}
          </div>
          <Seg
            small
            label="Text size"
            value={String(TEXT_SIZES.find((t) => Math.abs(t.value - options.fontSize) < 0.01)?.value ?? '')}
            onChange={(v) => onChange({ fontSize: Number(v) })}
            options={TEXT_SIZES.map((t) => ({ value: String(t.value), label: t.label }))}
          />
        </div>
      )}
      <div>
        <Pill size="sm" onClick={onAccessibility}>
          Accessibility menu
        </Pill>
        <p className="xs muted" style={{ marginTop: 6 }}>Ren’Py’s own menu for fonts, self-voicing and mono audio, where the game offers it.</p>
      </div>
      {options && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="row between" style={{ gap: 8 }}>
            <span className="small" style={{ fontWeight: 600 }}>For you in this game</span>
            {options.patchesFrom === 'admin' && <SourceLabel kind="admin" />}
          </div>
          <Switch
            checked={!!options.patches.rollback}
            label="Rollback"
            hint="Go back to earlier lines with the mouse wheel or Page Up, even where the game turns it off."
            onChange={(rollback) => onChange({ patches: { rollback } })}
          />
          <Switch
            checked={!!options.patches.skip}
            label="Skip"
            hint="Skip text you have read with Ctrl or Tab, even where the game turns it off."
            onChange={(skip) => onChange({ patches: { skip } })}
          />
          <Switch
            checked={!!options.patches.console}
            label="Developer console"
            hint="Ren’Py’s console, opened with Shift and O. For changing variables, at your own risk."
            onChange={(console) => onChange({ patches: { console } })}
          />
          <p className="xs muted">Kept with this game’s saves, so they follow you to every device. The game’s files do not change.</p>
        </div>
      )}
    </>
  )
}
