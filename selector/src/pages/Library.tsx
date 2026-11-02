import { useQuery } from '@tanstack/react-query'
import { Gamepad2, Play, Plus, RotateCcw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import GameCard, { Cover } from '../components/GameCard'
import { Button, Empty, cx } from '../components/ui'
import { api, slotName, type Game, type SavesResponse } from '../lib/api'
import { ago } from '../lib/format'
import { useGames } from '../lib/queries'

type Filter = 'all' | 'installed' | 'not_installed'

function ContinueHero({ game }: { game: Game }) {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['saves', game.slug],
    queryFn: () => api<SavesResponse>(`/api/saves/${game.slug}`),
    enabled: game.saves.count > 0,
  })
  const latest = data?.slots.find((s) => s.kind !== 'internal' && s.valid)
  const backdrop = latest?.screenshot
  return (
    <section className="relative mb-10 animate-fade-in overflow-hidden rounded-[28px] ring-1 ring-white/[0.08]">
      <div className="absolute inset-0">
        {backdrop ? (
          <img src={backdrop} alt="" className="size-full scale-105 object-cover blur-[2px]" />
        ) : (
          <Cover game={game} rounded={false} className="size-full" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/80 to-ink-950/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-transparent to-transparent" />
      </div>
      <div className="relative flex min-h-[300px] flex-col justify-end gap-5 p-6 sm:min-h-[360px] sm:p-10 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent-300">Continue playing</p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-5xl">{game.title}</h1>
          <p className="mt-3 text-sm text-zinc-300">
            {latest ? (
              <>
                {latest.name ? <span className="text-zinc-100">“{latest.name}” · </span> : null}
                {latest.label} · saved {ago(latest.ctime)}
              </>
            ) : (
              <>Last played {ago(game.lastPlayedAt)}</>
            )}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {latest ? (
              <Button variant="primary" size="lg" icon={<RotateCcw className="size-5" />} onClick={() => navigate(`/play/${game.slug}?resume=${encodeURIComponent(slotName(latest.file))}`)}>
                Resume
              </Button>
            ) : null}
            <Button variant={latest ? 'glass' : 'primary'} size="lg" icon={<Play className="size-5" />} onClick={() => navigate(`/play/${game.slug}`)}>
              {latest ? 'Main menu' : 'Play'}
            </Button>
            <Link to={`/game/${game.slug}`}>
              <Button variant="glass" size="lg">
                Details
              </Button>
            </Link>
          </div>
        </div>
        {latest?.screenshot && (
          <div className="hidden w-80 shrink-0 overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/15 lg:block">
            <img src={latest.screenshot} alt="" className="aspect-video w-full object-cover" />
          </div>
        )}
      </div>
    </section>
  )
}

export default function Library() {
  const { data: games, isLoading, error } = useGames()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tag, setTag] = useState<string | null>(null)

  const recent = useMemo(
    () => (games ?? []).filter((g) => g.status === 'installed' && g.lastPlayedAt).sort((a, b) => Date.parse(b.lastPlayedAt!) - Date.parse(a.lastPlayedAt!))[0],
    [games],
  )
  const tags = useMemo(() => [...new Set((games ?? []).flatMap((g) => g.tags))].sort(), [games])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (games ?? []).filter(
      (g) =>
        (!s || g.title.toLowerCase().includes(s) || g.tags.some((t) => t.toLowerCase().includes(s))) &&
        (filter === 'all' || (filter === 'installed' ? g.status === 'installed' || g.job : g.status !== 'installed' && !g.job)) &&
        (!tag || g.tags.includes(tag)),
    )
  }, [games, q, filter, tag])

  if (error) return <Empty title="Could not load the library">{String(error)}</Empty>

  return (
    <div>
      {recent && !q && <ContinueHero game={recent} />}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-white">Library</h2>
        <div className="flex flex-1 flex-wrap items-center gap-3 sm:justify-end">
          <div className="flex rounded-xl bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.06]">
            {(['all', 'installed', 'not_installed'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cx('rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors', filter === f ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200')}
              >
                {f === 'all' ? 'All' : f === 'installed' ? 'Installed' : 'Not installed'}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your games"
              className="h-10 w-full rounded-xl border-0 bg-white/[0.05] pl-10 pr-9 text-sm text-white ring-1 ring-inset ring-white/[0.08] placeholder:text-zinc-500 focus:outline-none focus:ring-accent-400/60"
            />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200" aria-label="Clear search">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {tags.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? null : t)}
              className={cx(
                'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors',
                tag === t ? 'bg-accent-500/20 text-accent-300 ring-accent-500/40' : 'bg-white/[0.04] text-zinc-400 ring-white/10 hover:text-zinc-200',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton aspect-video rounded-2xl" />
          ))}
        </div>
      ) : !games?.length ? (
        <Empty
          icon={<Gamepad2 className="size-10" />}
          title="Your library is empty"
          action={
            <Link to="/add">
              <Button variant="primary" icon={<Plus className="size-4" />}>
                Add your first game
              </Button>
            </Link>
          }
        >
          Drop Ren’Py game archives into the archives folder on the server, or upload one. Renplay unpacks, optimizes and prepares them for the browser.
        </Empty>
      ) : !shown.length ? (
        <Empty title="No games match">Try a different search or filter.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((g, i) => (
            <GameCard key={g.slug} game={g} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
