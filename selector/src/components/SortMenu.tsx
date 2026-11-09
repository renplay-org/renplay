import { Check, ChevronDown } from 'lucide-react'
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

export default function SortMenu({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const label = options.find((option) => option.value === value)?.label ?? 'Recent'
  return (
    <ActionMenu
      trigger={(open) => (
        <button className="sort" onClick={open} aria-label={`Sort games: ${label}`}>
          {label} <ChevronDown />
        </button>
      )}
    >
      {(close) =>
        options.map((option) => (
          <MenuItem key={option.value} icon={value === option.value ? <Check /> : undefined} onClick={() => { onChange(option.value); close() }}>
            {option.label}
          </MenuItem>
        ))
      }
    </ActionMenu>
  )
}
