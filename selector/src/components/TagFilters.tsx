import { useEffect, useRef, useState } from 'react'
import { Chip } from '../lantern/controls'

/** The chips a row shows before All tags: the chosen ones first, then the most common. */
const ROW = 8

/**
 * Tag chips for the Library. Tapping a chip adds the tag, and a game must have every tag chosen. The chips
 * stay in the order of `tags` (the most common over all games), the chosen ones first, and each counts the
 * games of the list as it is now: a chip nothing would show is dim.
 */
export default function TagFilters({ tags, counts, selected, onChange }: { tags: { id: string; label: string }[]; counts: Map<string, number>; selected: string[]; onChange: (ids: string[]) => void }) {
  const [more, setMore] = useState(false)
  // A chosen tag moves to the front of the row: the row goes back to its start, where it is.
  const row$ = useRef<HTMLDivElement>(null)
  useEffect(() => {
    row$.current?.scrollTo({ left: 0, behavior: 'instant' })
  }, [selected.join()])
  const chosen = selected.map((id) => tags.find((t) => t.id === id) ?? { id, label: id })
  const rest = tags.filter((t) => !selected.includes(t.id))
  const all = [...chosen, ...rest]
  return (
    <div className="chip-bar" style={{ marginBottom: 16 }}>
      <div className="chips wrap" ref={row$}>
        {all.slice(0, more ? undefined : Math.max(ROW, chosen.length)).map((tag) => {
          const on = selected.includes(tag.id)
          const n = counts.get(tag.id) ?? 0
          return (
            <Chip key={tag.id} on={on} n={n} dim={n === 0} onClick={() => onChange(on ? selected.filter((id) => id !== tag.id) : [...selected, tag.id])}>
              {tag.label}
            </Chip>
          )
        })}
      </div>
      {all.length > ROW && (
        <div className="chips">
          <Chip onClick={() => setMore(!more)}>{more ? 'Fewer tags' : 'All tags'}</Chip>
        </div>
      )}
    </div>
  )
}
