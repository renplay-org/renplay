import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import AuthLayout, { authInput } from '../components/AuthLayout'
import { Pill } from '../lantern/controls'
import { errorText } from '../components/ui'
import { api, post } from '../lib/api'
import { signInReturnUrl } from '../lib/sign-in-return'
import type { Providers } from '@shared/api'

export default function SignIn() {
  const [params] = useSearchParams()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<Providers>('/api/auth/providers') })
  if (providers.data && !providers.data.enabled) return <Navigate to="/" replace />
  // The public demo: one button, no account to make.
  if (providers.data?.demo)
    return (
      <AuthLayout>
        <div className="logo" style={{ justifyContent: 'center', marginBottom: 26 }}>
          <img src="/favicon.svg" alt="" />
          Renplay
        </div>
        <h1 className="h1 center" style={{ fontSize: 26 }}>Try Renplay</h1>
        <p className="lead center" style={{ margin: '8px auto 0' }}>
          A demo with free games. Play, save and pick up on another device. It starts fresh every few hours.
        </p>
        {error && (
          <p role="alert" className="small red center" style={{ marginTop: 14 }}>
            {error}
          </p>
        )}
        <div style={{ marginTop: 22 }}>
          <Pill
            variant="p"
            size="lg"
            className="block"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError('')
              try {
                await post('/api/auth/demo')
                window.location.assign(signInReturnUrl(params.get('return'), location.origin))
              } catch (e) {
                setError(errorText(e))
                setBusy(false)
              }
            }}
          >
            {busy ? 'Opening the demo' : 'Try the demo'}
          </Pill>
        </div>
        <p className="center small muted" style={{ marginTop: 18 }}>
          Like it? <a className="link" href="https://renplay.org/#install">Install your own</a> in a minute.
        </p>
      </AuthLayout>
    )
  return (
    <AuthLayout>
      <div className="logo" style={{ justifyContent: 'center', marginBottom: 26 }}>
        <img src="/favicon.svg" alt="" />
        Renplay
      </div>
      <h1 className="h1 center" style={{ fontSize: 26 }}>Sign in</h1>
      <p className="lead center" style={{ margin: '8px auto 0' }}>
        Your games and saves are waiting.
      </p>
      {providers.data?.oidc && (
        <div style={{ marginTop: 22 }}>
          <Pill variant="p" size="lg" className="block" href="/api/auth/oidc/start">
            Continue with {providers.data.oidc}
          </Pill>
        </div>
      )}
      {providers.data?.oidc && providers.data?.local && (
        <div className="row" style={{ margin: '18px 0 0' }}>
          <span className="grow" style={{ height: 1, background: 'var(--line)' }} />
          <span className="xs muted">or with a password</span>
          <span className="grow" style={{ height: 1, background: 'var(--line)' }} />
        </div>
      )}
      {providers.data?.local && (
        <form
          method="post"
          action="/api/auth/login"
          className="stack"
          style={{ marginTop: 18 }}
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            const form = new FormData(event.currentTarget)
            try {
              await post('/api/auth/login', { username: form.get('username'), password: form.get('password') })
              window.location.assign(signInReturnUrl(params.get('return'), location.origin))
            } catch (e) {
              setError(errorText(e))
              setBusy(false)
            }
          }}
        >
          <label className="field">
            <span>Username</span>
            <input name="username" autoComplete="username" autoCapitalize="none" required className={authInput} />
          </label>
          <label className="field">
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required className={authInput} />
          </label>
          {error && (
            <p role="alert" className="small red">
              {error}
            </p>
          )}
          <Pill variant={providers.data?.oidc ? 's' : 'p'} className="block" type="submit" disabled={busy}>
            {busy ? 'Signing in' : 'Sign in'}
          </Pill>
        </form>
      )}
      <p className="center small muted" style={{ marginTop: 18 }}>
        Forgot your password? Ask an admin to reset it.
      </p>
      {providers.data?.setup && (
        <p className="center small" style={{ marginTop: 10 }}>
          <Link to="/setup" className="link">
            First run? Claim this server
          </Link>
        </p>
      )}
    </AuthLayout>
  )
}
