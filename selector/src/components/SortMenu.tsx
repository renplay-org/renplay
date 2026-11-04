import { ArrowDownWideNarrow, Check } from 'lucide-react'
import Sheet from './Sheet'
import { Button, MenuItem } from './ui'

const options = [
  { value: 'recent', label: 'Recent' },
  { value: 'played', label: 'Last played' },
  { value: 'title', label: 'Title' },
  { value: 'added', label: 'Recently added' },
]

export default function SortMenu({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const label = options.find((option) => option.value === value)?.label ?? 'Recent'
  return (
    <Sheet trigger={(open) => <Button icon={<ArrowDownWideNarrow className="size-4" />} onClick={open} aria-label={`Sort games: ${label}`}>{label}</Button>}>
      {(close) => options.map((option) => (
        <MenuItem key={option.value} icon={value === option.value ? <Check /> : undefined} onClick={() => { onChange(option.value); close() }}>
          {option.label}
        </MenuItem>
      ))}
    </Sheet>
  )
}
