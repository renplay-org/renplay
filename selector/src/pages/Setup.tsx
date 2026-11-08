import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'
import AuthLayout, { authInput } from '../components/AuthLayout'
import { Pill } from '../lantern/controls'
import { errorText } from '../components/ui'
import { api, post } from '../lib/api'
import type { Providers } from '@shared/api'

export default function Setup() {
  const [grant, setGrant] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<Providers>('/api/auth/providers') })
  if (providers.data && !providers.data.setup) return <Navigate to="/" replace />
  return (
    <AuthLayout wide>
      <div className="logo" style={{ justifyContent: 'center', marginBottom: 18 }}>
        <img src="/favicon.svg" alt="" />
        Renplay
      </div>
      <div className="steps" style={{ justifyContent: 'center', marginBottom: 18 }}>
        <b>1 Claim the server</b>
        <i />
        <span className={grant ? 'fg' : ''}>2 Your account</span>
        <i />
        <span>3 First game</span>
      </div>
      <h1 className="h1 center" style={{ fontSize: 26 }}>
        {grant ? 'Your owner account' : 'Prove you run this server'}
      </h1>
      <p className="lead center" style={{ margin: '8px auto 0' }}>
        {grant ? 'This account owns every save made before sign-in was turned on.' : 'Renplay printed a one-time setup code when it started. Paste it here.'}
      </p>
      <div className="panel" style={{ marginTop: 20 }}>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            const form = new FormData(event.currentTarget)
            try {
              if (!grant) setGrant((await post<{ grant: string }>('/api/auth/setup/verify', { code: form.get('code') })).grant)
              else {
                await post('/api/auth/setup', { grant, username: form.get('username'), name: form.get('name'), password: form.get('password') })
                window.location.assign('/')
              }
            } catch (e) {
              setError(errorText(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {!grant ? (
            <>
              <label className="field">
                <span>Setup code</span>
                <input key="code" name="code" autoCapitalize="none" autoComplete="off" spellCheck={false} required className={`${authInput} mono`} style={{ height: 56, fontSize: 20, letterSpacing: '0.2em', textAlign: 'center' }} />
              </label>
              <p className="hint">
                Find it with <code>docker logs renplay | grep "Setup code"</code>, or in the app’s log on your NAS. Skipped when the admin is set by environment variables.
              </p>
            </>
          ) : (
            <>
              <label className="field">
                <span>Name</span>
                <input name="name" autoComplete="name" required className={authInput} />
              </label>
              <label className="field">
                <span>Username</span>
                <input name="username" autoComplete="username" autoCapitalize="none" required className={authInput} />
              </label>
              <label className="field">
                <span>Password</span>
                <input name="password" type="password" autoComplete="new-password" aria-describedby="password-hint" minLength={10} required className={authInput} />
              </label>
              <p id="password-hint" className="hint">
                Use at least 10 characters.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="small red">
              {error}
            </p>
          )}
          <Pill variant="p" className="block" type="submit" disabled={busy}>
            {busy ? 'Please wait' : grant ? 'Create owner account' : 'Continue'}
          </Pill>
        </form>
      </div>
      {!grant && (
        <p className="center small muted" style={{ marginTop: 18 }}>
          Already set an admin username and password on the server?{' '}
          <Link to="/signin" className="link-q">
            Sign in instead.
          </Link>
        </p>
      )}
    </AuthLayout>
  )
}
