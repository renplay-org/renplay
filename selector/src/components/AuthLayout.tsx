import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { ReactNode } from 'react'

export default function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { data } = useQuery({ queryKey: ['health'], queryFn: () => api<{ version: string }>('/api/health') })
  return <div className="app-backdrop safe-x safe-top safe-bottom flex min-h-screen flex-col text-zinc-100"><main className="flex flex-1 items-center justify-center px-5 py-10"><div className={`w-full ${wide ? 'max-w-md' : 'max-w-sm'}`}>{children}</div></main><footer className="px-5 pb-6 text-center text-xs text-zinc-500">Renplay{data?.version ? ` ${data.version}` : ''} · The Renplay Team</footer></div>
}
export const authInput = 'h-12 w-full rounded-xl bg-white/[0.05] px-4 text-base text-white ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-accent-400/60'
