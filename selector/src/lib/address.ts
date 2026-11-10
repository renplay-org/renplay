import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/** The query string `search` with `changes` applied: a null value takes the key out. */
export function withParams(search: string, changes: Record<string, string | null>): URLSearchParams {
  const next = new URLSearchParams(search)
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  return next
}

/**
 * Search, filters and tags live in the address, so a reload or a shared link shows the same list. They
 * are replaced, never pushed: the back button leaves the page instead of undoing a keystroke.
 */
export function useAddress(): [URLSearchParams, (changes: Record<string, string | null>) => void] {
  const [params, setParams] = useSearchParams()
  const set = (changes: Record<string, string | null>) => {
    setParams(withParams(window.location.search, changes), { replace: true })
  }
  return [params, set]
}

/** A text field whose value reaches the address after a short pause, and follows the address when that changes. */
export function useTypedField(value: string, commit: (value: string) => void, ms = 200): [string, (text: string) => void] {
  const [text, setText] = useState(value)
  const sent = useRef(value)
  useEffect(() => {
    if (value === sent.current) return
    sent.current = value
    setText(value)
  }, [value])
  useEffect(() => {
    if (text === sent.current) return
    const timer = window.setTimeout(() => {
      sent.current = text
      commit(text)
    }, ms)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  return [text, setText]
}
