import { CloudOff, Heart, Plus, Library as LibraryIcon, LayoutGrid, Sparkles, User } from 'lucide-react'
import { keptGames, removeKept, useOnline } from '../lib/offline'
import ChooseArtwork from './ChooseArtwork'
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { api } from '../lib/api'
import { jobTitle } from '../lib/format'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useAuth } from '../lib/auth'
import AccountMenu from './AccountMenu'
import { useGames, useJobs } from '../lib/queries'
import { RoomProvider } from '../lantern/Room'
import { useArrowFocus } from '../lantern/focus'
import { useFlightBack } from '../lantern/flight'
import type { Health } from '@shared/api'
import { Pill } from '../lantern/controls'
import { focusSearch, wantSearch } from '../lantern/Search'
import { isApple } from '../lib/platform'

// Links go through renplay.org (redirects on the website), so moving GitHub or Ko-fi needs no release.
const REPO_URL = 'https://renplay.org/github'
const KOFI_URL = 'https://renplay.org/support'

function GitHubMark({ className }: { className?: string }) {
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
  const { data } = useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/api/health') })
  return (
    <footer className="foot">
      <span>Renplay{data?.version ? ` ${data.version}` : ''}</span>
      <span className="sep" aria-hidden="true">·</span>
      <a href="https://renplay.org/docs" target="_blank" rel="noreferrer">
        Docs
      </a>
      <span className="sep" aria-hidden="true">·</span>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className="row" style={{ gap: 6 }}>
        <GitHubMark className="size-3.5" /> GitHub
      </a>
      <span className="sep" aria-hidden="true">·</span>
      <a href={KOFI_URL} target="_blank" rel="noreferrer" className="row" style={{ gap: 6 }}>
        <Heart style={{ width: 14, height: 14 }} /> Support on Ko-fi
      </a>
      <span className="sep" aria-hidden="true">·</span>
      <span>The Renplay Team</span>
    </footer>
  )
}

/**
 * A new page starts at its top. Back and forward return to where that page was left. The browser's
 * own restoring is off: it ran before a page had its content, and a game page opened halfway down.
 */
function useScrollMemory() {
  const location = useLocation()
  const type = useNavigationType()
  const page = useRef(location.pathname)
  useLayoutEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  }, [])
  // A search, a filter or an open game changes the address without leaving the page: the place is kept
  // under the history entry (its number, which a replaced address keeps), not under every address it had.
  const entry: unknown = window.history.state?.idx ?? location.key
  useLayoutEffect(() => {
    // The first page of a tab always has the key "default": the entry's number keeps one page's place from another's.
    const key = `renplay:scroll:${entry}:${location.pathname}`
    // A change of the same page's address (a search, a filter, an open game) keeps the scroll where it is.
    const same = type !== 'POP' && page.current === location.pathname
    page.current = location.pathname
    const saved = type === 'POP' ? Number(sessionStorage.getItem(key)) : 0
    let y = same ? window.scrollY : saved || 0
    // Instant: the page's smooth scrolling is for scrolls a person asks for.
    if (!same) window.scrollTo({ top: y, behavior: 'instant' })
    // A page that fills in a moment later is scrolled again once it is tall enough.
    const again = saved ? requestAnimationFrame(() => window.scrollTo({ top: saved, behavior: 'instant' })) : 0
    const save = () => {
      try {
        sessionStorage.setItem(key, String(Math.round(y)))
      } catch {}
    }
    let t = 0
    const onScroll = () => {
      y = window.scrollY
      clearTimeout(t)
      t = window.setTimeout(save, 120)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(again)
      clearTimeout(t)
      // Leaving within the pause still keeps where the page was.
      save()
      window.removeEventListener('scroll', onScroll)
    }
  }, [entry, type])
}

/** Where typing goes to a field of its own: a key that is a shortcut elsewhere is not one here. */
const typesInto = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/** Ctrl K, ⌘K or / (outside a field) goes to the search above the list, opening the Library first from a page that has none. */
function useSearchShortcut() {
  const navigate = useNavigate()
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const slash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typesInto(e.target)
      if (!slash && (e.key.toLowerCase() !== 'k' || !(isApple() ? e.metaKey : e.ctrlKey))) return
      e.preventDefault()
      if (focusSearch()) return
      wantSearch()
      navigate('/')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [navigate])
}

function Shell() {
  useScrollMemory()
  useSearchShortcut()
  useFlightBack()
  const { data } = useAuth()
  const admin = data?.user.role === 'admin'
  useArrowFocus()
  const tabs = [
    { to: '/', label: 'Library', icon: LibraryIcon, end: true },
    { to: '/catalog', label: 'Catalog', icon: LayoutGrid, end: false },
    ...(admin ? [{ to: '/add', label: 'Add games', icon: Plus, end: false }] : []),
    { to: '/account', label: 'You', icon: User, end: false },
  ]
  const online = useOnline()
  const { data: games } = useGames()
  // A kept copy of an uninstalled game goes too. A copy belongs to the browser, so a game this person
  // does not see (another person kept it) stays.
  useEffect(() => {
    if (!online || !games) return
    const uninstalled = new Set(games.filter((g) => g.status !== 'installed').map((g) => g.id))
    for (const id of Object.keys(keptGames())) if (uninstalled.has(id)) void removeKept(id)
  }, [online, games])
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
              <Pill variant="s" size="sm" to="/add" className="hide-phone" aria-label="Add games">
                <Plus />
                <span className="lbl">Add games</span>
              </Pill>
            )}
            {admin && <ActivityRing />}
            <span className="hide-phone">
              <AccountMenu />
            </span>
          </div>
        </div>
      </header>
      <main className="rise">
        {data?.demo && (
          <p className="notice" role="note" style={{ margin: '12px 16px 0' }}>
            <Sparkles aria-hidden />
            <span>
              This is a demo of Renplay with free games. It starts fresh every few hours, so nothing you do here is kept. The demo has adult games turned off.{' '}
              <a className="link" href="https://renplay.org/#install">
                Install your own
              </a>
            </span>
          </p>
        )}
        {!online && (
          <p className="notice amber" role="status" style={{ margin: '12px 16px 0' }}>
            <CloudOff aria-hidden />
            Offline. Games kept in this browser still play, and their saves are sent when you are back online.
          </p>
        )}
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
