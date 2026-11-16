import { ArrowUpDown, Check, ChevronDown } from 'lucide-react'
import ActionMenu from './ActionMenu'
import { MenuItem } from '../lantern/ui'

const options = [
  { value: 'recent', label: 'Recent' },
  { value: 'played', label: 'Last played' },
  { value: 'title', label: 'Title' },
  { value: 'added', label: 'Recently added' },
  { value: 'rating', label: 'Rating' },
  { value: 'time', label: 'Time played' },
]

/** The order of the list, a quiet word with a caret (an icon on a phone). While a search is typed it offers Best match first, which a search starts in. */
export default function SortMenu({ value, onChange, searching = false }: { value: string; onChange: (value: string) => void; searching?: boolean }) {
  const all = searching ? [{ value: 'match', label: 'Best match' }, ...options] : options
  const label = all.find((option) => option.value === value)?.label ?? 'Recent'
  return (
    <ActionMenu
      trigger={(open) => (
        <button className="sort" onClick={open} aria-label={`${label}, change the order`}>
          <span className="lbl">{label}</span>
          <ChevronDown className="caret" />
          <ArrowUpDown className="swap" />
        </button>
      )}
    >
      {(close) =>
        all.map((option) => (
          <MenuItem key={option.value} icon={value === option.value ? <Check /> : undefined} onClick={() => { onChange(option.value); close() }}>
            {option.label}
          </MenuItem>
        ))
      }
    </ActionMenu>
  )
}
