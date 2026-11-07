import { useState } from 'react'
import { Chip } from '../lantern/controls'

export default function TagFilters({ tags, selected, onSelect }: { tags: { id: string; label: string; count?: number }[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const [more, setMore] = useState(false)
  return (
    <div className="chips wrap" style={{ marginBottom: 16 }}>
      {tags.slice(0, more ? undefined : 8).map((tag) => (
        <Chip key={tag.id} on={selected === tag.id} n={tag.count} onClick={() => onSelect(selected === tag.id ? null : tag.id)}>
          {tag.label}
        </Chip>
      ))}
      {tags.length > 8 && <Chip onClick={() => setMore(!more)}>{more ? 'Fewer tags' : 'All tags'}</Chip>}
    </div>
  )
}
