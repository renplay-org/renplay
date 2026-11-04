import { cx } from './ui'
import type { ReactNode } from 'react'

export default function SegmentedControl<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: ReactNode }[] }) {
  return <div className="inline-flex max-w-full rounded-xl bg-white/5 p-1" role="group">{options.map((option) => <button key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={cx('inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm whitespace-nowrap', value === option.value ? 'bg-white/10 text-white shadow' : 'text-zinc-400')}>{option.label}</button>)}</div>
}
