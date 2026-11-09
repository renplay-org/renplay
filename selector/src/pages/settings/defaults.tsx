import { useQueryClient } from '@tanstack/react-query'
import { errorText, useToast } from '../../lantern/ui'
import { Seg } from '../../lantern/controls'
import CatalogTags from '../../components/CatalogTags'
import { put } from '../../lib/api'
import { useCatalog, useDefaults } from '../../lib/queries'
import type { Defaults } from '@shared/defaults'
import { TEXT_SIZES } from '@shared/defaults'
import { Setting } from './common'

/** What everyone starts with until they choose: tags left out, Lighter background, text size, Rollback and Skip. */
export function DefaultsForEveryone() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: d } = useDefaults()
  const { data: catalog } = useCatalog()
  if (!d) return null
  const save = async (patch: Partial<Defaults>) => {
    try {
      const next = await put<Defaults>('/api/defaults', { ...d, ...patch })
      qc.setQueryData(['defaults'], next)
      void qc.invalidateQueries({ queryKey: ['me-tags'] })
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  const tri = (v: boolean | null) => (v === null ? 'unset' : v ? 'on' : 'off')
  const fromTri = (v: string) => (v === 'unset' ? null : v === 'on')
  return (
    <section className="panel stack" style={{ gap: 14 }}>
      <div>
        <h2 className="h3">Defaults for everyone</h2>
        <p className="small muted" style={{ marginTop: 6 }}>What people start with until they choose their own. Each person can still change these for themselves.</p>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <div>
          <div style={{ fontWeight: 650 }}>Tags left out on the Catalog page</div>
          <p className="small muted" style={{ marginTop: 2 }}>Games with these tags are hidden in the catalog for people who have not chosen their own tags. A tap leaves a tag out, the next brings it back.</p>
        </div>
        {catalog && (
          <CatalogTags games={catalog.games} vocabulary={catalog.vocabulary} prefs={{ include: [], exclude: d.tagsExclude }} onChange={(next) => void save({ tagsExclude: next.exclude })} excludeOnly />
        )}
      </div>
      <Setting title="Lighter background" hint="For browsers where nobody chose. Each device follows its own reduced motion and data saver settings unless this says otherwise.">
        <Seg
          small
          label="Lighter background for everyone"
          value={tri(d.lighterBackground)}
          onChange={(v) => void save({ lighterBackground: fromTri(v) })}
          options={[
            { value: 'unset', label: 'Each device' },
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
          ]}
        />
      </Setting>
      <Setting title="Text size in games" hint="Ren’Py’s text size in games where the person has not chosen one in the player’s Options.">
        <Seg
          small
          label="Text size for everyone"
          value={d.textSize === null ? 'unset' : String(d.textSize)}
          onChange={(v) => void save({ textSize: v === 'unset' ? null : Number(v) })}
          options={[
            { value: 'unset', label: 'As the game has it' },
            ...TEXT_SIZES.filter((t) => t.value !== 1).map((t) => ({ value: String(t.value), label: t.label })),
          ]}
        />
      </Setting>
      {(['rollback', 'skip'] as const).map((k) => (
        <Setting key={k} title={k === 'rollback' ? 'Rollback in games' : 'Skip in games'} hint={k === 'rollback' ? 'Go back to earlier lines even where a game turns it off, until a person chooses in Options.' : 'Skip read text even where a game turns it off, until a person chooses in Options.'}>
          <Seg
            small
            label={k === 'rollback' ? 'Rollback for everyone' : 'Skip for everyone'}
            value={d[k] ? 'on' : 'unset'}
            onChange={(v) => void save({ [k]: v === 'on' ? true : null })}
            options={[
              { value: 'unset', label: 'As the game has it' },
              { value: 'on', label: 'On' },
            ]}
          />
        </Setting>
      ))}
    </section>
  )
}
