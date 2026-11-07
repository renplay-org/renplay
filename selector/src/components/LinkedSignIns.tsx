import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, post } from '../lib/api'
import { Button, Modal, errorText, accountInput } from './ui'

export default function LinkedSignIns() {
  const qc = useQueryClient(), [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<{ oidc: string | null; ldap: boolean }>('/api/auth/providers') })
  const identities = useQuery({ queryKey: ['identities'], queryFn: () => api<{ identities: { provider: string; subject: string; name: string; available: boolean; removable: boolean }[] }>('/api/me/identities') })
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await qc.invalidateQueries() } catch (e) { setError(errorText(e)) } finally { setBusy(false) } }
  return <div className="space-y-3"><p className="text-sm text-zinc-400">Any linked sign-in opens this account. Keep at least one enabled way to sign in. Unlinking ends your other sessions and removes the admin access and the adult games level that sign-in gave you. Admin access set in Users is kept.</p>
    {identities.data?.identities.map(i => <div key={i.provider + i.subject} className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 py-3"><div className="min-w-0"><p className="text-sm text-white">{i.name}{!i.available && ' · Unavailable'}</p><p className="break-all text-xs text-zinc-400">{i.subject}</p></div><Button className="min-h-11" disabled={busy || !i.removable} onClick={() => void run(() => api('/api/me/identities', { method: 'DELETE', json: { provider: i.provider, subject: i.subject } }))}>Unlink</Button></div>)}
    <div className="flex flex-wrap gap-2">{providers.data?.oidc && <Button className="min-h-11" disabled={busy} onClick={() => void run(async () => { const r = await post<{ url: string }>('/api/me/identities/oidc'); window.location.assign(r.url) })}>Link {providers.data.oidc}</Button>}{providers.data?.ldap && <Button className="min-h-11" onClick={() => setOpen(true)}>Link LDAP</Button>}</div>
    {(error || identities.isError) && <p role="alert" className="text-sm text-rose-300">{error || errorText(identities.error)}</p>}
    <Modal open={open} title="Link LDAP" onClose={() => setOpen(false)}><form className="space-y-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run(async () => { await post('/api/me/identities/ldap', { username: f.get('username'), password: f.get('password') }); setOpen(false) }) }}><p className="text-sm text-zinc-400">Sign in to your directory account to link it. Existing accounts are not merged.</p><label className="block text-sm text-zinc-300">Username<input name="username" required autoComplete="username" className={accountInput} /></label><label className="block text-sm text-zinc-300">Password<input name="password" type="password" required autoComplete="current-password" className={accountInput} /></label>{error && <p role="alert" className="text-sm text-rose-300">{error}</p>}<Button type="submit" loading={busy} variant="primary">Link LDAP</Button></form></Modal>
  </div>
}
