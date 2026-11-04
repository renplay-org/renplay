import { useState } from 'react'
import { Button, cx } from './ui'

export default function TagFilters({ tags, selected, onSelect }: { tags: { id: string; label: string }[]; selected: string | null; onSelect: (id: string | null) => void }) {
  const [more, setMore] = useState(false)
  return <div className="mb-6 flex flex-wrap gap-2">{tags.slice(0, more ? undefined : 8).map((tag) => <button key={tag.id} aria-pressed={selected === tag.id} onClick={() => onSelect(selected === tag.id ? null : tag.id)} className={cx('min-h-10 rounded-full px-3 text-xs font-medium ring-1 ring-inset', selected === tag.id ? 'bg-accent-500/20 text-accent-300 ring-accent-500/40' : 'bg-white/[0.04] text-zinc-400 ring-white/10')}>{tag.label}</button>)}{tags.length > 8 && <Button size="sm" onClick={() => setMore(!more)}>{more ? 'Less' : 'More'}</Button>}</div>
}
