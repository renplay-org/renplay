import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Avatar from '../components/Avatar'
import AvatarUpload from '../components/AvatarUpload'
import LinkedSignIns from '../components/LinkedSignIns'
import AdultPreferences, { accountInput } from '../components/AdultPreferences'
import { Button, Confirm, Modal, Spinner, errorText, useToast } from '../components/ui'
import { api, del, post, put } from '../lib/api'
import { useAuth } from '../lib/auth'
import { ago } from '../lib/format'

export function AccountSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 space-y-4 rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/[0.07] sm:p-6"><h2 className="font-semibold text-white">{title}</h2>{children}</section>
}
interface Session { id: string; label: string; created_at: number; touched_at: number; expires_at: number; current: boolean }
interface Token { id: string; name: string; created_at: number }

function sessionLabel(label: string): string {
  const browser = /Edg\//.test(label) ? 'Edge' : /Firefox\//.test(label) ? 'Firefox' : /Chrome\//.test(label) ? 'Chrome' : /Safari\//.test(label) ? 'Safari' : 'Browser'
  const device = /iPhone/.test(label) ? 'iPhone' : /iPad/.test(label) ? 'iPad' : /Android/.test(label) ? 'Android' : /Windows/.test(label) ? 'Windows' : /Macintosh|Mac OS/.test(label) ? 'Mac' : /Linux/.test(label) ? 'Linux' : ''
  return device ? `${browser} on ${device}` : 'Browser session'
}

export default function Account() {
  const { data: me } = useAuth(), qc = useQueryClient(), toast = useToast()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ sessions: Session[] }>('/api/me/sessions') })
  const tokens = useQuery({ queryKey: ['tokens'], queryFn: () => api<{ tokens: Token[] }>('/api/me/tokens') })
  const [dialog, setDialog] = useState<'password' | 'token' | ''>('')
  const [confirm, setConfirm] = useState<{ title: string; action: () => Promise<unknown> } | null>(null)
  const [secret, setSecret] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (!me) return <Spinner />
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true); setError('')
    try { await action(); await qc.invalidateQueries(); toast(message, 'success'); return true }
    catch (e) { setError(errorText(e)); toast(errorText(e), 'error'); return false }
    finally { setBusy(false) }
  }
  return <div className="animate-fade-in space-y-6">
    <header className="flex items-center gap-4"><Avatar name={me.user.name} avatar={me.user.avatar} className="size-16 text-xl" /><div className="min-w-0"><h1 className="font-display text-3xl font-bold text-white">Account</h1><p className="break-words text-sm text-zinc-400">{me.user.name} · {me.user.role === 'admin' ? 'Admin' : 'Player'}{me.auth ? '' : ' · Sign-in is off'}</p></div></header>
    {!me.auth && <AccountSection title="Sign-in is off"><p className="text-sm text-zinc-300">Everyone uses this account ({me.user.name}). Other users’ saves stay separate and untouched.</p><a className="inline-flex min-h-11 items-center text-sm text-accent-300 underline" href="https://renplay.org/docs/accounts/" target="_blank" rel="noreferrer">How to turn on sign-in</a></AccountSection>}
    {me.unclaimed && me.user.role === 'admin' && me.user.id !== 1 && <AccountSection title="Claim the owner account"><p className="text-sm text-zinc-400">Keep the saves made before sign-in and bring your current saves with you. Replaced files stay in history.</p><Button onClick={() => setConfirm({ title: 'Claim the owner account?', action: async () => { await post('/api/me/claim-owner'); window.location.reload() } })}>Claim the owner account</Button></AccountSection>}
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <AccountSection title="Profile">
        <form onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void run(() => put('/api/me', { name: form.get('name') }), 'Display name saved') }} className="space-y-4">
          <label className="block text-sm text-zinc-300">Display name<input key={me.user.name} name="name" autoComplete="name" required maxLength={100} defaultValue={me.user.name} className={accountInput} /></label>
          <Button className="min-h-11" type="submit" loading={busy}>Save name</Button>
        </form>
        <p className="text-sm text-zinc-400">Username: {me.user.username}. </p>
        <AvatarUpload />
        {me.hasPassword && <Button className="min-h-11" onClick={() => { setError(''); setDialog('password') }}>Change password</Button>}
      </AccountSection>
      {me.user.adult_access === 1 && <AccountSection title="Adult pictures"><AdultPreferences /></AccountSection>}
      <AccountSection title="Linked sign-ins"><LinkedSignIns /></AccountSection>
      <AccountSection title="Where you are signed in">
        {sessions.isPending ? <Spinner /> : sessions.isError ? <p role="alert" className="text-sm text-rose-300">{errorText(sessions.error)}</p> : <div className="divide-y divide-white/10">{sessions.data.sessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="min-w-0 flex-1"><p className="break-words text-sm text-zinc-200">{session.current ? 'This session' : sessionLabel(session.label)}</p><p className="text-xs text-zinc-400">Active {ago(session.touched_at)} · Expires {ago(session.expires_at, true)}</p></div>
          <Button className="min-h-11" onClick={() => setConfirm({ title: 'Sign out of this session?', action: async () => { await del(`/api/me/sessions/${session.id}`); if (session.current) window.location.assign('/signin') } })}>Sign out</Button>
        </div>)}{!sessions.data.sessions.length && <p className="py-2 text-sm text-zinc-400">No signed-in sessions. {me.auth ? '' : 'Sign-in is off.'}</p>}</div>}
        <Button className="min-h-11" disabled={!sessions.data?.sessions.some((s) => !s.current)} onClick={() => setConfirm({ title: 'Sign out everywhere else?', action: () => del('/api/me/sessions') })}>Sign out everywhere else</Button>
      </AccountSection>
      <AccountSection title="Access tokens">
        <p className="text-sm text-zinc-400">For scripts and the upload tool. A token acts as you; keep it private.</p>
        {tokens.isPending ? <Spinner /> : tokens.isError ? <p role="alert" className="text-sm text-rose-300">{errorText(tokens.error)}</p> : <div className="divide-y divide-white/10">{tokens.data.tokens.map((token) => <div className="flex items-center justify-between gap-3 py-3" key={token.id}><div className="min-w-0"><p className="break-words text-sm text-zinc-200">{token.name}</p><p className="text-xs text-zinc-400">Created {ago(token.created_at)}</p></div><Button className="min-h-11" onClick={() => setConfirm({ title: `Revoke ${token.name}?`, action: () => del(`/api/me/tokens/${token.id}`) })}>Revoke</Button></div>)}{!tokens.data.tokens.length && <p className="text-sm text-zinc-400">No access tokens.</p>}</div>}
        <Button className="min-h-11" onClick={() => { setError(''); setSecret(''); setDialog('token') }}>New token</Button>
      </AccountSection>
      <AccountSection title="Your saves"><p className="text-sm text-zinc-400">Export current saves for the games you can see, including shared keys and HTML game data, as one zip. Hidden games’ saves and save history stay on the server.</p><a className="inline-flex min-h-11 items-center rounded-xl bg-white/[0.07] px-4 text-sm text-white ring-1 ring-white/10" href="/api/saves-export">Export all my saves</a></AccountSection>
    </div>
    <Modal open={!!dialog} onClose={() => { if (!busy) { setDialog(''); setSecret('') } }} title={dialog === 'password' ? 'Change password' : 'New token'}>
      {secret ? <div className="space-y-4"><p className="text-sm text-zinc-300">Copy this token now. It will not be shown again.</p><textarea aria-label="Access token" readOnly value={secret} className={`${accountInput} h-28 break-all p-3 font-mono`} onFocus={(e) => e.target.select()} /><Button className="min-h-11" onClick={async () => { try { await navigator.clipboard.writeText(secret); toast('Token copied', 'success') } catch { toast('Select the token and copy it.', 'error') } }}>Copy token</Button></div> : <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); const form = new FormData(e.currentTarget)
        if (dialog === 'password') {
          if (await run(() => post('/api/me/password', { current: form.get('current'), password: form.get('password') }), 'Password changed. Other sessions ended.')) setDialog('')
        } else await run(async () => { const result = await post<{ token: string }>('/api/me/tokens', { name: form.get('name') }); setSecret(result.token) }, 'Token created')
      }}>
        {dialog === 'password' ? <><p className="text-sm text-zinc-400">Your other sessions will end. Your saves stay safe.</p><label className="block text-sm text-zinc-300">Current password<input name="current" type="password" autoComplete="current-password" required className={accountInput} /></label><label className="block text-sm text-zinc-300">New password<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={1024} required className={accountInput} /></label></> : <label className="block text-sm text-zinc-300">Token name<input name="name" required maxLength={100} placeholder="Upload script" className={accountInput} /></label>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        <Button className="min-h-11" variant="primary" type="submit" loading={busy}>{dialog === 'password' ? 'Change password' : 'Create token'}</Button>
      </form>}
    </Modal>
    <Confirm open={!!confirm} onClose={() => !busy && setConfirm(null)} title={confirm?.title || ''} confirmLabel="Confirm" busy={busy} onConfirm={async () => { if (confirm && await run(confirm.action, 'Done')) setConfirm(null) }}>This takes effect immediately. Your saves are kept.</Confirm>
  </div>
}
