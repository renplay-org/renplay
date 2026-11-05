import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { post, put } from '../lib/api'
import { type AdultPictures } from '../lib/prefs'
import { Button, Modal, errorText } from './ui'

export default function AccountMenu({ tab = false }: { tab?: boolean }) {
  const { data } = useAuth()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  if (!data) return null
  const admin = data.user.role === 'admin'
  return <div>
    <button aria-expanded={open} onClick={() => setOpen(!open)} className={tab ? 'flex min-h-14 w-full flex-col items-center gap-1 py-2 text-[11px] text-zinc-300' : 'flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-zinc-200'}>
      <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-violet-500 font-semibold text-white">{data.user.name.slice(0, 1).toUpperCase()}</span>
      <span className="max-w-24 truncate">{tab ? 'You' : data.user.name}</span>
    </button>
    <Modal open={open} onClose={() => setOpen(false)} title="Your account" footer={<>
      {data.auth && <Button onClick={async () => {
        try { await post('/api/auth/logout'); window.location.assign('/signin') } catch (e) { setError(errorText(e)) }
      }}>Sign out</Button>}
      <Button onClick={() => setOpen(false)}>Close</Button>
    </>}>
      <div className="space-y-4">
        <h2 className="font-semibold text-white">{data.user.name}</h2>
        <p className="text-sm text-zinc-400">{admin ? 'Admin' : 'Player'}</p>
        <label className="block text-sm text-zinc-300">Adult games
          <select defaultValue={JSON.parse(data.user.prefs || '{}').adultPictures || 'hide-pictures'} className="mt-2 h-12 w-full rounded-xl bg-zinc-900 px-3" onChange={async (e) => {
            try { await put('/api/me/prefs', { adultPictures: e.target.value as AdultPictures }); await qc.invalidateQueries() } catch (error) { setError(errorText(error)) }
          }}>
            <option value="show">Show</option><option value="hide-pictures">Hide pictures</option><option value="hide-games">Hide adult games</option>
          </select>
        </label>
        {admin && data.unclaimed && data.user.id !== 1 && <Button onClick={async () => {
          try { await post('/api/me/claim-owner'); window.location.reload() } catch (e) { setError(errorText(e)) }
        }}>Claim the owner account</Button>}
        {admin && <Link onClick={() => setOpen(false)} to="/activity" className="block min-h-11 py-3 text-sm text-zinc-300">Activity</Link>}
        <Link onClick={() => setOpen(false)} to="/settings" className="block min-h-11 py-3 text-sm text-zinc-300">{admin ? 'Settings' : 'This browser'}</Link>
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      </div>
    </Modal>
  </div>
}
