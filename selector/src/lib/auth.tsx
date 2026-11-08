import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { api, ApiError } from './api'
import { Spinner } from '../components/ui'
import { setAdminLighterBackground } from './backdrop'
import { useDefaults } from './queries'
import type { Me, Providers } from '@shared/api'

export function useAuth() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me'), retry: false })
}
export function AuthGuard({ admin = false }: { admin?: boolean }) {
  const me = useAuth(), location = useLocation()
  useEffect(() => {
    const refresh = () => { void me.refetch() }
    window.addEventListener('renplay:signed-out', refresh)
    return () => window.removeEventListener('renplay:signed-out', refresh)
  }, [me.refetch])
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<Providers>('/api/auth/providers') })
  if (providers.data?.setup && !providers.data.oidc && !providers.data.ldap && !me.isPending && !(me.data?.user.role === 'admin' && me.data.user.id !== 1)) return <Navigate to="/setup" replace />
  if (me.isPending || providers.isPending) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>
  if (me.error instanceof ApiError && me.error.status === 401 && (!me.data || !location.pathname.startsWith('/play/'))) return <Navigate to={`/signin?return=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (!me.data) return <p className="p-6 text-zinc-300">Could not reach Renplay. Reload to try again.</p>
  if (admin && me.data.user.role !== 'admin') return <Navigate to="/" replace />
  return <WithDefaults />
}

/** The signed-in pages, with the admin's defaults applied to this browser. */
function WithDefaults() {
  // The admin's default for Lighter background, for browsers that did not choose.
  const defaults = useDefaults()
  useEffect(() => {
    setAdminLighterBackground(defaults.data?.lighterBackground ?? null)
  }, [defaults.data?.lighterBackground])
  return <Outlet />
}
