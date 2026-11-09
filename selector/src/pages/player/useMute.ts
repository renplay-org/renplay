import { useState } from 'react'

/** Muting works like muting a tab, for every game in this browser; the runtime reads it at start. */
const MUTE_KEY = 'renplay:muted'

/** The player's mute: kept per browser and sent to the game. */
export function useMute(send: (msg: Record<string, unknown>) => void): [boolean, () => void] {
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1')
  const toggle = () => {
    const next = !muted
    setMuted(next)
    if (next) localStorage.setItem(MUTE_KEY, '1')
    else localStorage.removeItem(MUTE_KEY)
    send({ type: 'renplay:mute', value: next })
  }
  return [muted, toggle]
}
