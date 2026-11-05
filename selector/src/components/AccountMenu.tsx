import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { post } from '../lib/api'
import Avatar from './Avatar'
import { Button, Modal, errorText } from './ui'

export default function AccountMenu({ tab = false }: { tab?: boolean }) {
  const { data } = useAuth()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  if (!data) return null
  const admin = data.user.role === 'admin'
  return <div>
    <button aria-expanded={open} onClick={() => setOpen(!open)} className={tab ? 'flex min-h-14 w-full flex-col items-center gap-1 py-2 text-[11px] text-zinc-300' : 'flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm text-zinc-200'}>
      <Avatar name={data.user.name} avatar={data.user.avatar} className="size-8" />
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
        <Link onClick={() => setOpen(false)} to="/account" className="block min-h-11 py-3 text-sm text-zinc-300">Account</Link>
        {admin && <Link onClick={() => setOpen(false)} to="/settings/users" className="block min-h-11 py-3 text-sm text-zinc-300">Users</Link>}
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
