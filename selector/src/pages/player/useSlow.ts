import { useEffect, useState } from 'react'

/** Saves usually reach the server within a second. The Syncing sign shows only when one takes longer than this. */
export const SLOW_SYNC = 5_000

/** True once `on` has stayed true for `ms`, and false again as soon as it is false. */
export function useSlow(on: boolean, ms: number): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!on) {
      setSlow(false)
      return
    }
    const timer = setTimeout(() => setSlow(true), ms)
    return () => clearTimeout(timer)
  }, [on, ms])
  return slow
}
