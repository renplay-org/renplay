import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { api } from '../lib/api'
import { RoomProvider, useRoom } from '../lantern/Room'
import type { Health } from '@shared/api'

function BrandRoom() {
  useRoom({ game: null, brand: true })
  return null
}

/** Sign-in and setup: the logo on the brand room, one narrow column. */
export default function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { data } = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/api/health') })
  return (
    <RoomProvider>
      <BrandRoom />
      <div className="auth" role="main">
        <div className="box" style={wide ? { maxWidth: 448 } : undefined}>
          {children}
          <p className="center xs muted" style={{ marginTop: 28 }}>
            Renplay{data?.version ? ` ${data.version}` : ''} · The Renplay Team
          </p>
        </div>
      </div>
    </RoomProvider>
  )
}
