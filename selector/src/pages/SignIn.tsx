import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import AuthLayout, { authInput } from '../components/AuthLayout'
import { Button, errorText } from '../components/ui'
import { api, post } from '../lib/api'
import { signInReturnUrl } from '../lib/sign-in-return'

export default function SignIn() {
  const [params] = useSearchParams()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<{ enabled: boolean; setup: boolean; local: boolean; oidc: string | null }>('/api/auth/providers') })
  if (providers.data && !providers.data.enabled) return <Navigate to="/" replace />
  return <AuthLayout><div className="mb-8 text-center"><img src="/favicon.svg" alt="" className="mx-auto size-14 rounded-2xl shadow-lg" /><h1 className="mt-5 font-display text-2xl font-bold text-white">Sign in to Renplay</h1><p className="mt-2 text-sm text-zinc-400">Your games and saves are waiting.</p></div>
    {providers.data?.local && <form method="post" action="/api/auth/login" className="space-y-4" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('')
      const form = new FormData(event.currentTarget)
      try {
        await post('/api/auth/login', { username: form.get('username'), password: form.get('password') })
        window.location.assign(signInReturnUrl(params.get('return'), location.origin))
      } catch (e) { setError(errorText(e)); setBusy(false) }
    }}>
      <label className="block text-sm">Username<input name="username" autoComplete="username" autoCapitalize="none" required className={`${authInput} mt-2`} /></label>
      <label className="block text-sm">Password<input name="password" type="password" autoComplete="current-password" required className={`${authInput} mt-2`} /></label>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy} className="h-12 w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
    </form>}
    {providers.data?.oidc && <a href="/api/auth/oidc/start" className="mt-5 flex min-h-12 w-full items-center justify-center rounded-2xl bg-white/[0.07] px-4 text-sm font-medium text-white ring-1 ring-white/10">Continue with {providers.data.oidc}</a>}
    {providers.data?.setup && <Link to="/setup" className="mt-4 inline-flex min-h-11 items-center text-sm text-accent-300">First run? Claim this server</Link>}<p className="mt-8 text-center text-xs text-zinc-500">Forgot your password? Ask an admin to reset it.</p>
  </AuthLayout>
}
