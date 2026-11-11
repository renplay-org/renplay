import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Chip, Pill } from '../lantern/controls'
import Sheet from '../lantern/Sheet'
import { api, put } from '../lib/api'
import type { Vocabulary } from '@shared/recipe'
import { gameTags } from '../lib/tags'
import type { TagPrefs as TagPrefsAnswer } from '@shared/api'

/** The tags a person includes and leaves out, as the Catalog page works with them. */
type TagPrefs = Pick<TagPrefsAnswer, 'include' | 'exclude'>

type Tagged = Parameters<typeof gameTags>[0]
type State = 'off' | 'include' | 'exclude'

const GROUPS: Array<[string, string]> = [
  ['play', 'Play'],
  ['story', 'Story'],
  ['art', 'Art'],
  ['protagonist', 'Protagonist'],
  ['content', 'Content'],
]

/** Whether a game passes the tags: every included one, none of the left out ones. */
export function matchesTags(game: Tagged, prefs: TagPrefs, vocabulary: Vocabulary): boolean {
  if (!prefs.include.length && !prefs.exclude.length) return true
  const ids = new Set(gameTags(game, vocabulary).map((t) => t.id))
  return prefs.include.every((t) => ids.has(t)) && !prefs.exclude.some((t) => ids.has(t))
}

/**
 * The tags this person includes and leaves out on the Catalog page, kept with their account. The
 * answer comes from the server, changes are saved after a short pause.
 */
export function useTagPrefs(): [TagPrefs, (next: TagPrefs) => void] {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['me-tags'], queryFn: () => api<TagPrefsAnswer>('/api/me/tags'), staleTime: 60_000 })
  const [local, setLocal] = useState<TagPrefs | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const set = (next: TagPrefs) => {
    setLocal(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      // The demo refuses it and an offline browser cannot send it: then the choice lasts this visit.
      void put<TagPrefsAnswer>('/api/me/tags', next).then((saved) => qc.setQueryData(['me-tags'], saved)).catch(() => {})
    }, 600)
  }
  return [local ?? data ?? { include: [], exclude: [] }, set]
}

function stateOf(prefs: TagPrefs, id: string): State {
  return prefs.include.includes(id) ? 'include' : prefs.exclude.includes(id) ? 'exclude' : 'off'
}

function withState(prefs: TagPrefs, id: string, state: State): TagPrefs {
  const include = prefs.include.filter((t) => t !== id)
  const exclude = prefs.exclude.filter((t) => t !== id)
  if (state === 'include') include.push(id)
  if (state === 'exclude') exclude.push(id)
  return { include, exclude }
}

/** What a tap on a tag does: includes it, then leaves it out, then clears it (both), or only one of the two. */
type Mode = 'both' | 'include' | 'exclude'

/**
 * Tag chips for the catalog and the library: a tap includes a tag, the next leaves it out, the next clears it
 * (the library only includes, and a game must have every tag included). Each chip counts the `games` shown now
 * that have the tag, and a chip nothing would show is dim. The row keeps the order of the most common tags over
 * `all` the games (the chosen ones first), so it does not rearrange while a search is typed. All tags opens every
 * tag by group. `onClear`, given while a tag or a filter is on, puts Clear filters first in the row, in the place
 * of the last two common tags, so a row that fits still fits.
 */
export default function CatalogTags({ games, all = games, vocabulary, prefs, onChange, onClear, mode = 'both' }: { games: Tagged[]; all?: Tagged[]; vocabulary: Vocabulary; prefs: TagPrefs; onChange: (next: TagPrefs) => void; onClear?: () => void; mode?: Mode }) {
  const [sheet, setSheet] = useState(false)
  // A chosen tag moves to the front of the row: the row goes back to its start, where it is.
  const row = useRef<HTMLDivElement>(null)
  // Every tag of every game, most common first, each with how many of the games shown have it.
  const counts = new Map<string, { id: string; label: string; group: string; count: number; total: number }>()
  for (const g of all) for (const t of gameTags(g, vocabulary)) {
    const e = counts.get(t.id) ?? { id: t.id, label: t.label, group: t.group, count: 0, total: 0 }
    e.total++
    counts.set(t.id, e)
  }
  if (games !== all) for (const g of games) for (const t of gameTags(g, vocabulary)) counts.get(t.id)!.count++
  else for (const e of counts.values()) e.count = e.total
  const chosen = [...prefs.include, ...prefs.exclude]
  useEffect(() => {
    row.current?.scrollTo({ left: 0, behavior: 'instant' })
  }, [chosen.join()])
  // The row: chosen tags first, then the most common play and story tags.
  const common = [...counts.values()].filter((t) => (t.group === 'play' || t.group === 'story') && t.total >= 2 && !chosen.includes(t.id)).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
  const label = (id: string) => counts.get(id)?.label ?? vocabulary[id]?.label ?? id
  // One of the two only (the library includes, the defaults for everyone leave out): off and that.
  const next = (id: string): State => (mode === 'both' ? ({ off: 'include', include: 'exclude', exclude: 'off' } as const)[stateOf(prefs, id)] : stateOf(prefs, id) === mode ? 'off' : mode)
  const chip = (id: string, n?: number) => {
    const state = stateOf(prefs, id)
    return (
      <Chip
        key={id}
        on={state === 'include'}
        ex={state === 'exclude'}
        n={n}
        dim={n === 0}
        aria-label={`${label(id)}${n === undefined ? '' : ` ${n}`}, ${state === 'include' ? 'included' : state === 'exclude' ? 'left out' : 'any'}`}
        onClick={() => onChange(withState(prefs, id, next(id)))}
      >
        {label(id)}
      </Chip>
    )
  }
  return (
    <>
      <div className="chip-bar" style={{ marginBottom: 16 }}>
        <div className="chips wrap" ref={row}>
          {onClear && (
            <Chip onClick={onClear}>
              Clear filters
              <X aria-hidden="true" />
            </Chip>
          )}
          {chosen.map((id) => chip(id, counts.get(id)?.count ?? 0))}
          {common.slice(0, Math.max(0, 8 - chosen.length - (onClear ? 2 : 0))).map((t) => chip(t.id, t.count))}
        </div>
        <div className="chips">
          {mode === 'exclude' && chosen.length > 0 && <Chip onClick={() => onChange({ include: [], exclude: [] })}>Clear tags</Chip>}
          <Chip onClick={() => setSheet(true)}>All tags</Chip>
        </div>
      </div>
      {sheet && (
        <Sheet open onClose={() => setSheet(false)} title="Tags" wide fullPhone>
          <p className="small muted" style={{ marginBottom: 16 }}>
            {mode === 'exclude'
              ? 'Games with a tag left out here are hidden in the catalog for everyone who has not chosen their own tags.'
              : mode === 'include'
                ? 'Include a tag to see only games that have it. A game must have every tag you include.'
                : 'Include a tag to see only games that have it. Leave one out to hide games that have it. Your choices are kept for next time, on every device.'}
          </p>
          <div className="stack" style={{ gap: 20 }}>
            {GROUPS.map(([group, title]) => {
              const tags = [...counts.values()].filter((t) => t.group === group).sort((a, b) => a.label.localeCompare(b.label))
              if (!tags.length) return null
              return (
                <section key={group}>
                  <h3 className="small" style={{ fontWeight: 650, marginBottom: 6 }}>{title}</h3>
                  <div className="list tight">
                    {tags.map((t) => {
                      const state = stateOf(prefs, t.id)
                      return (
                        <div key={t.id} className="row between" style={{ gap: 12, minHeight: 'var(--hit)' }}>
                          <span>
                            {t.label} <span className="muted tnum">{t.count}</span>
                          </span>
                          <span className="row" style={{ gap: 6 }}>
                            {mode !== 'exclude' && <Pill variant={state === 'include' ? 'p' : 'q'} size="sm" aria-pressed={state === 'include'} onClick={() => onChange(withState(prefs, t.id, state === 'include' ? 'off' : 'include'))}>
                              Include
                            </Pill>}
                            {mode !== 'include' && <Pill variant={state === 'exclude' ? 'd' : 'q'} size="sm" aria-pressed={state === 'exclude'} onClick={() => onChange(withState(prefs, t.id, state === 'exclude' ? 'off' : 'exclude'))}>
                              Leave out
                            </Pill>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        </Sheet>
      )}
    </>
  )
}
