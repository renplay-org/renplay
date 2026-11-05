import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'
import AuthLayout, { authInput } from '../components/AuthLayout'
import { Button, errorText } from '../components/ui'
import { api, post } from '../lib/api'

export default function Setup() {
  const [grant, setGrant] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<{ setup: boolean }>('/api/auth/providers') })
  if (providers.data && !providers.data.setup) return <Navigate to="/" replace />
  return <AuthLayout wide><div className="mb-6 flex items-center gap-3"><img src="/favicon.svg" alt="" className="size-9" /><span className="font-display font-semibold">Renplay</span><span className="ml-auto text-xs text-zinc-500">First run</span></div>
    <ol className="mb-7 flex flex-wrap gap-4 text-xs text-zinc-400">{['Claim this server', 'Your account', 'First game'].map((label, i) => <li key={label} className="flex items-center gap-2"><span className={`flex size-6 items-center justify-center rounded-full ${i === (grant ? 1 : 0) ? 'bg-accent-500 text-white' : 'bg-white/10'}`}>{i + 1}</span>{label}</li>)}</ol>
    <h1 className="font-display text-2xl font-bold text-white">{grant ? 'Your owner account' : 'Prove you run this server'}</h1>
    <p className="mt-3 text-sm leading-relaxed text-zinc-400">{grant ? 'This account owns every save made before sign-in was turned on.' : 'So nobody else on your network can take the owner account first, Renplay printed a one-time code when it started. Find it in the container log:'}</p>
    {!grant && <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-4 text-xs text-zinc-300">{'docker logs renplay | grep "Setup code"'}</pre>}
    <form className="mt-5 space-y-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('')
      const form = new FormData(event.currentTarget)
      try {
        if (!grant) setGrant((await post<{ grant: string }>('/api/auth/setup/verify', { code: form.get('code') })).grant)
        else { await post('/api/auth/setup', { grant, username: form.get('username'), name: form.get('name'), password: form.get('password') }); window.location.assign('/') }
      } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
    }}>
      {!grant ? <label className="block text-sm">Setup code<input key="code" name="code" autoCapitalize="none" autoComplete="off" spellCheck={false} required className={`${authInput} mt-2 h-14 text-center font-mono tracking-widest`} /></label> : <>
        <label className="block text-sm">Name<input name="name" autoComplete="name" required className={`${authInput} mt-2`} /></label>
        <label className="block text-sm">Username<input name="username" autoComplete="username" autoCapitalize="none" required className={`${authInput} mt-2`} /></label>
        <label className="block text-sm">Password<input name="password" type="password" autoComplete="new-password" aria-describedby="password-hint" minLength={10} required className={`${authInput} mt-2`} /></label><p id="password-hint" className="text-xs text-zinc-500">Use at least 10 characters.</p>
      </>}
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy} className="h-12 w-full">{busy ? 'Please wait…' : grant ? 'Create owner account' : 'Continue'}</Button>
    </form>{!grant && <p className="mt-5 text-xs leading-relaxed text-zinc-500">Already set an admin username and password on the server? <Link to="/signin" className="text-zinc-300 underline">Sign in instead.</Link></p>}
  </AuthLayout>
}
