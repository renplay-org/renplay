import { Search, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { isApple } from '../lib/platform'
import './Search.css'

/** The field on screen, which Ctrl K or ⌘K goes to. */
let field: HTMLInputElement | null = null
/** Ctrl K was pressed on a page with no search: the next one takes the focus. */
let wanted = false

/** Moves the focus to the page's search. False when this page has none. */
export function focusSearch(): boolean {
  if (!field) return false
  field.focus()
  field.select()
  return true
}

export function wantSearch(): void {
  wanted = true
}

/**
 * The search: one field above a list, filtering it as you type. A pill like the controls beside it, with
 * its shortcut shown on a desktop (a phone has no keyboard shortcuts) and a clear button while it holds text.
 */
export default function SearchField({ value, onChange, label }: { value: string; onChange: (text: string) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    field = input.current
    if (wanted) {
      wanted = false
      input.current?.focus()
    }
    return () => {
      if (field === input.current) field = null
    }
  }, [])
  return (
    <div className="search-field">
      <Search aria-hidden="true" />
      <input
        ref={input}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-label={label}
        aria-keyshortcuts={isApple() ? 'Meta+K' : 'Control+K'}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          if (value) onChange('')
          else input.current?.blur()
        }}
      />
      {value ? (
        <button type="button" className="clear" aria-label="Clear the search" onClick={() => { onChange(''); input.current?.focus() }}>
          <X aria-hidden="true" />
        </button>
      ) : (
        <kbd className="shortcut" aria-hidden="true">{isApple() ? '⌘K' : 'Ctrl K'}</kbd>
      )}
    </div>
  )
}
