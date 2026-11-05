import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { api, ApiError } from './api'
import { Spinner } from '../components/ui'

export interface Account {
  id: number
  username: string
  name: string
  role: 'admin' | 'player'
  adult_access: number
  prefs: string
  avatar?: string
  roleManaged?: boolean
  adultManaged?: boolean
}
export function useAuth() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<{ user: Account; auth: boolean; unclaimed: boolean; hasPassword: boolean }>('/api/me'), retry: false })
}
export function AuthGuard({ admin = false }: { admin?: boolean }) {
  const me = useAuth(), location = useLocation()
  useEffect(() => {
    const refresh = () => { void me.refetch() }
    window.addEventListener('renplay:signed-out', refresh)
    return () => window.removeEventListener('renplay:signed-out', refresh)
  }, [me.refetch])
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => api<{ enabled: boolean; setup: boolean; oidc: string | null; ldap: boolean }>('/api/auth/providers') })
  if (providers.data?.setup && !providers.data.oidc && !providers.data.ldap && !me.isPending && !(me.data?.user.role === 'admin' && me.data.user.id !== 1)) return <Navigate to="/setup" replace />
  if (me.isPending || providers.isPending) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>
  if (me.error instanceof ApiError && me.error.status === 401 && (!me.data || !location.pathname.startsWith('/play/'))) return <Navigate to={`/signin?return=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (!me.data) return <p className="p-6 text-zinc-300">Could not reach Renplay. Reload to try again.</p>
  if (admin && me.data.user.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}
