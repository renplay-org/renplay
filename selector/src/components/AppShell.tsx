import { Activity, Library, Plus, Settings } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useJobs } from '../lib/queries'
import { cx } from './ui'

function Logo() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5">
      <span className="relative flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent-400 to-violet-500 shadow-[0_6px_20px_-6px_rgb(244_80_138/0.7)]">
        <svg viewBox="0 0 24 24" className="size-4 fill-white" aria-hidden>
          <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
        </svg>
      </span>
      <span className="font-display text-[17px] font-semibold tracking-tight text-white">renplay</span>
    </NavLink>
  )
}

export default function AppShell() {
  const { data } = useJobs()
  const active = (data?.jobs ?? []).filter((j) => j.status === 'running' || j.status === 'queued').length
  const item = ({ isActive }: { isActive: boolean }) =>
    cx(
      'relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:text-zinc-100',
    )
  return (
    <div className="app-backdrop min-h-screen">
      <header className="safe-top sticky top-0 z-40 border-b border-white/[0.05] bg-ink-950/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-6 px-4 sm:px-8">
          <Logo />
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={item}>
              <Library className="size-4" />
              <span className="hidden sm:inline">Library</span>
            </NavLink>
            <NavLink to="/add" className={item}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">Add games</span>
            </NavLink>
            <NavLink to="/activity" className={item}>
              <Activity className="size-4" />
              <span className="hidden sm:inline">Activity</span>
              {active > 0 && (
                <span className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[11px] font-semibold text-white">
                  {active}
                </span>
              )}
            </NavLink>
          </nav>
          <div className="ml-auto">
            <NavLink to="/settings" className={item} aria-label="Settings">
              <Settings className="size-4" />
            </NavLink>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 pb-24 pt-6 sm:px-8">
        <Outlet />
      </main>
    </div>
  )
}
