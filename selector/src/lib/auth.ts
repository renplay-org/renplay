import { useQuery } from '@tanstack/react-query'
import type { Me, Providers } from '@shared/api'
import { api } from './api'

/** The signed-in person, or the 401 that says nobody is. */
export function useAuth() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/me'), retry: false })
}

/** The static demo has no server behind it: what needs one is left out rather than shown and refused. */
export function useStaticDemo(): boolean {
  return !!useAuth().data?.demoStatic
}

/** How people sign in here. */
export function useProviders() {
  return useQuery({ queryKey: ['providers'], queryFn: () => api<Providers>('/api/auth/providers') })
}
