import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { U } from './controls'
import { padKeys } from './focus'
import './Words.css'

/** The id a tab and its panel share, so each names the other. */
export const tabId = (group: string, value: string) => `${group}-tab-${value}`
export const panelId = (group: string, value: string) => `${group}-panel-${value}`

/**
 * Real tabs, drawn as the website draws its filter: words, the chosen one lit with a lamp underline. A row
 * that does not fit scrolls sideways and keeps the chosen tab in view. Every tab stays in the tab order, so a
 * controller reaches each one, and the arrow keys move between them. A tab opens with Enter, Space or a tap.
 * `group` is the prefix of the ids a panel names back (`tabId`, `panelId`).
 */
export function Tabs<T extends string>({ value, onChange, options, label, group, small }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode }>; label: string; group: string; small?: boolean }) {
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!row.current || !el) return
    const room = 24
    const [from, to] = [el.offsetLeft - room, el.offsetLeft + el.offsetWidth + room]
    if (from < row.current.scrollLeft) row.current.scrollLeft = from
    else if (to > row.current.scrollLeft + row.current.clientWidth) row.current.scrollLeft = to - row.current.clientWidth
  }, [value])
  // A controller's stick moves by where things are; only a keyboard's arrows come here.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (padKeys.has(e.nativeEvent)) return
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)')]
    const at = tabs.indexOf(document.activeElement as HTMLElement)
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key]
    if (at < 0 || next === undefined || !tabs[next]) return
    e.preventDefault()
    tabs[next]!.focus()
  }
  return (
    <div ref={row} role="tablist" aria-label={label} className={`seg tabs scroll ${small ? 'sm' : ''}`.trim()} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" id={tabId(group, o.value)} aria-selected={o.value === value} aria-controls={o.value === value ? panelId(group, o.value) : undefined} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          <U>{o.label}</U>
        </button>
      ))}
    </div>
  )
}
