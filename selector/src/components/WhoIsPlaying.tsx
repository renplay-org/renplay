import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Pill } from '../lantern/controls'
import Sheet from '../lantern/Sheet'
import { api, post } from '../lib/api'
import Avatar from './Avatar'
import { errorText } from './ui'

/*
 * Who is playing? On a device that is already signed in, switch to another person who has signed in
 * on this browser before and set a PIN. Admins are never switched to by PIN.
 */

const KEY = 'renplay:people'

/** The people who signed in on this browser, most recent first. */
export function peopleHere(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0).slice(0, 20) : []
  } catch {
    return []
  }
}

export function rememberPerson(id: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...peopleHere().filter((n) => n !== id)].slice(0, 20)))
  } catch {}
}

export default function WhoIsPlaying({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ids = peopleHere()
  const people = useQuery({
    queryKey: ['switch', ids.join(',')],
    enabled: open,
    queryFn: () => api<{ people: Array<{ id: number; name: string; avatar: string }> }>(`/api/auth/switch?people=${ids.join(',')}`).then((r) => r.people),
  })
  const [chosen, setChosen] = useState<{ id: number; name: string } | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => {
    setChosen(null)
    setPin('')
    setError('')
    onClose()
  }
  const go = async () => {
    if (!chosen) return
    setBusy(true)
    setError('')
    try {
      await post('/api/auth/switch', { user: chosen.id, pin })
      // A fresh start as the other person: nothing of the last one stays in memory.
      window.location.assign('/')
    } catch (e) {
      setError(errorText(e))
      setPin('')
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onClose={close} title={chosen ? `${chosen.name}, your PIN` : 'Who is playing?'}>
      {chosen ? (
        <form
          className="stack"
          style={{ gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault()
            void go()
          }}
        >
          <input
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{4,8}"
            maxLength={8}
            aria-label="PIN"
            placeholder="PIN"
            value={pin}
            autoFocus
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center' }}
          />
          {error && (
            <p role="alert" className="small amber">
              {error}
            </p>
          )}
          <div className="row" style={{ gap: 8 }}>
            <Pill variant="p" type="submit" aria-disabled={busy || pin.length < 4}>
              Switch
            </Pill>
            <Pill variant="q" onClick={() => (setChosen(null), setPin(''), setError(''))}>
              Back
            </Pill>
          </div>
          <p className="xs muted">The person playing now is signed out on this device. They come back with their PIN or their sign-in.</p>
        </form>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {people.data?.length ? (
            <div className="list">
              {people.data.map((p) => (
                <button key={p.id} type="button" className="row" style={{ gap: 12, minHeight: 56, width: '100%', textAlign: 'left' }} onClick={() => setChosen(p)}>
                  <Avatar name={p.name} avatar={p.avatar} />
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="small muted">{people.isPending ? 'Loading' : 'Nobody else can switch in on this browser yet. People who sign in here once and set a PIN in their account appear here.'}</p>
          )}
          <p className="xs muted">Admins switch in with their full sign-in, never a PIN.</p>
        </div>
      )}
    </Sheet>
  )
}
