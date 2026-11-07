import { Heart, Plus, Library as LibraryIcon, LayoutGrid, User } from 'lucide-react'
import ChooseArtwork from './ChooseArtwork'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { api, jobTitle } from '../lib/api'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import AccountMenu from './AccountMenu'
import SearchPalette from './SearchPalette'
import { useGames, useJobs } from '../lib/queries'
import { RoomProvider } from '../lantern/Room'
import { useArrowFocus } from '../lantern/focus'

// Links go through renplay.org (redirects on the website), so moving GitHub or Ko-fi needs no release.
export const REPO_URL = 'https://renplay.org/github'
export const KOFI_URL = 'https://renplay.org/support'

export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

/** The activity ring: always in the header, its arc the running job's progress. Opens Activity. */
function ActivityRing() {
  const { data } = useJobs()
  const { data: games } = useGames()
  const active = (data?.jobs ?? []).filter((j) => j.status === 'running' || j.status === 'queued')
  const job = active.find((j) => j.status === 'running') ?? active[0]
  return (
    <Link to="/activity" className="act" aria-label={job ? jobTitle(job, games ?? []) : 'Activity'}>
      <span className={`ring ${job ? '' : 'idle'}`} style={job ? ({ '--p': `${Math.round(job.progress * 100)}%` } as React.CSSProperties) : undefined} />
      <span className="lbl truncate">{job ? jobTitle(job, games ?? []) : 'Activity'}</span>
    </Link>
  )
}

function Footer() {
  const { data } = useQuery({ queryKey: ['health'], queryFn: () => api<{ version: string }>('/api/health') })
  return (
    <footer className="foot">
      <span>Renplay{data?.version ? ` ${data.version}` : ''}</span>
      <span aria-hidden="true">·</span>
      <a href="https://renplay.org/docs" target="_blank" rel="noreferrer">
        Docs
      </a>
      <span aria-hidden="true">·</span>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className="row" style={{ gap: 6 }}>
        <GitHubMark className="size-3.5" /> GitHub
      </a>
      <span aria-hidden="true">·</span>
      <a href={KOFI_URL} target="_blank" rel="noreferrer" className="row" style={{ gap: 6 }}>
        <Heart style={{ width: 14, height: 14 }} /> Support on Ko-fi
      </a>
      <span aria-hidden="true">·</span>
      <span>The Renplay Team</span>
    </footer>
  )
}

function Shell() {
  const { data } = useAuth()
  const admin = data?.user.role === 'admin'
  useArrowFocus()
  const tabs = [
    { to: '/', label: 'Library', icon: LibraryIcon, end: true },
    { to: '/catalog', label: 'Catalog', icon: LayoutGrid, end: false },
    ...(admin ? [{ to: '/add', label: 'Add games', icon: Plus, end: false }] : []),
    { to: '/account', label: 'You', icon: User, end: false },
  ]
  return (
    <>
      <header className="top">
        <div className="top-in">
          <NavLink to="/" className="logo" aria-label="Renplay, the library">
            <img src="/favicon.svg" alt="" />
            Renplay
          </NavLink>
          <nav className="nav" aria-label="Sections">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'on' : '')}>
              Library
            </NavLink>
            <NavLink to="/catalog" className={({ isActive }) => (isActive ? 'on' : '')}>
              Catalog
            </NavLink>
          </nav>
          <div className="top-r">
            {admin && (
              <Link to="/add" className="btn s sm hide-phone" aria-label="Add games">
                <Plus />
                <span className="lbl">Add games</span>
              </Link>
            )}
            {admin && <ActivityRing />}
            <SearchPalette />
            <span className="hide-phone">
              <AccountMenu />
            </span>
          </div>
        </div>
      </header>
      <main className="rise">
        <Outlet />
      </main>
      <Footer />
      {admin && <ChooseArtwork />}
      <nav className="tabbar" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }} aria-label="Sections">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'on' : '')}>
            <t.icon />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}

export default function AppShell() {
  return (
    <RoomProvider>
      <Shell />
    </RoomProvider>
  )
}
