import { Heart, Library, Loader2, Plus, Settings } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { api, jobTitle } from '../lib/api'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import AccountMenu from './AccountMenu'
import { pct } from '../lib/format'
import { useGames, useJobs } from '../lib/queries'
import { cx } from './ui'

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

function Logo() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="size-8 rounded-xl shadow-[0_6px_20px_-6px_rgb(244_80_138/0.7)]" />
      <span className="font-display text-[17px] font-semibold tracking-tight text-white">Renplay</span>
    </NavLink>
  )
}

/** Shown while installs or other jobs run; opens the activity log. */
function JobIndicator() {
  const { data } = useJobs()
  const { data: games } = useGames()
  const active = (data?.jobs ?? []).filter((j) => j.status === 'running' || j.status === 'queued')
  if (!active.length) return null
  const job = active.find((j) => j.status === 'running') ?? active[0]!
  return (
    <Link
      to="/activity"
      className="flex min-w-0 items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-[13px] text-zinc-200 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/10"
    >
      <Loader2 className="size-3.5 shrink-0 animate-spin text-accent-300" />
      <span className="hidden max-w-56 truncate sm:inline">{jobTitle(job, games ?? [])}</span>
      {job.status === 'running' && <span className="tabular-nums text-zinc-400">{pct(job.progress)}</span>}
      {active.length > 1 && <span className="text-zinc-500">+{active.length - 1}</span>}
    </Link>
  )
}

function Footer() {
  const { data } = useQuery({ queryKey: ['health'], queryFn: () => api<{ version: string }>('/api/health') })
  return (
    <footer className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 pb-28 pt-4 text-xs text-zinc-500 sm:px-8 sm:pb-8">
      <span>Renplay{data?.version ? ` ${data.version}` : ''}</span>
      <span aria-hidden="true">·</span>
      <a href="https://renplay.org/docs" target="_blank" rel="noreferrer" className="transition-colors hover:text-zinc-300">Docs</a>
      <span aria-hidden="true">·</span>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-zinc-300">
        <GitHubMark className="size-3.5" /> GitHub
      </a>
      <span aria-hidden="true">·</span>
      <a href={KOFI_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-accent-300">
        <Heart className="size-3.5" /> Support
      </a>
    </footer>
  )
}

const TABS = [
  { to: '/', label: 'Library', icon: Library, end: true },
  { to: '/add', label: 'Add games', icon: Plus, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

export default function AppShell() {
  const { data } = useAuth()
  const admin = data?.user.role === 'admin'
  const tabs = TABS.filter((t) => t.to !== '/add' || admin).map((t) => t.to === '/settings' ? { ...t, label: data?.auth ? 'You' : 'Settings' } : t)
  const item = ({ isActive }: { isActive: boolean }) =>
    cx(
      'relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:text-zinc-100',
    )
  return (
    <div className="app-backdrop safe-x flex min-h-screen flex-col">
      <header className="safe-top sticky top-0 z-40 border-b border-white/[0.05] bg-ink-950/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:h-16 sm:px-8">
          <Logo />
          <nav className="hidden items-center gap-1 sm:flex">
            {tabs.filter((t) => t.to !== '/settings').map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={item}>
                <t.icon className="size-4" />
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {admin && <JobIndicator />}
            <AccountMenu />
            <NavLink to="/settings" className={(s) => cx(item(s), 'hidden sm:flex')} aria-label="Settings">
              <Settings className="size-4" />
            </NavLink>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pt-5 sm:px-8 sm:pt-6">
        {admin && data && !data.auth && <aside className="mb-5 rounded-xl bg-amber-400/10 p-4 text-sm text-amber-200">Sign-in is off. Everyone plays as {data.user.name}. <a className="underline" href="https://docs.renplay.org/accounts/">Turn on sign-in</a>.</aside>}
        <Outlet />
      </main>
      <Footer />
      {/* Tab bar on phones. */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-ink-950/85 backdrop-blur-xl sm:hidden">
        <div className={`grid ${admin ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {tabs.map((t) => t.to === '/settings' && data?.auth ? <AccountMenu key="you" tab /> : (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) => cx('flex flex-col items-center gap-1 pb-1.5 pt-2.5 text-[11px] font-medium', isActive ? 'text-white' : 'text-zinc-500')}
            >
              <t.icon className="size-5" />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
