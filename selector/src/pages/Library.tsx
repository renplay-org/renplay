import { useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import GameCard from '../components/GameCard'
import EmptyLibrary from '../components/EmptyLibrary'
import TagFilters from '../components/TagFilters'
import { Button, Empty, Spinner } from '../components/ui'
import { api, slotName, type Game, type SavesResponse } from '../lib/api'
import { useBlurAdultCovers } from '../lib/prefs'
import { useCatalog, useGames } from '../lib/queries'
import { gameTags, matchesSearch, tagChips } from '../lib/tags'

function Continue({ game }: { game: Game }) {
  const { data } = useQuery({ queryKey: ['saves', game.id], queryFn: () => api<SavesResponse>(`/api/saves/${game.id}`), enabled: game.saves.count > 0 })
  const latest = data?.slots.find((s) => s.kind !== 'internal' && s.valid)
  const [blur] = useBlurAdultCovers()
  const screenshot = latest?.screenshot && !(blur && game.nsfw) ? latest.screenshot : null
  const resumeUrl = `/play/${game.id}${latest ? `?resume=${encodeURIComponent(slotName(latest.file))}` : ''}`
  if (!screenshot) return (
    <section className="mb-8 flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-4">
      <p className="min-w-0 truncate text-sm text-zinc-300">Continue playing · <Link className="font-semibold text-white" to={`/game/${game.id}`}>{game.title}</Link></p>
      <Link className="shrink-0" to={resumeUrl}><Button icon={<Play className="size-4" />}>{latest ? 'Resume' : 'Play'}</Button></Link>
    </section>
  )
  return (
    <section className="relative mb-8 flex min-h-[300px] items-end overflow-hidden rounded-3xl p-6 sm:min-h-[360px] sm:p-10">
      <img src={screenshot} alt="" className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/80 to-ink-950/10" />
      <div className="relative min-w-0">
        <p className="mb-2 text-sm font-medium text-accent-300">Continue playing</p>
        <h1 className="font-display text-3xl font-bold text-white sm:text-5xl">{game.title}</h1>
        <p className="mt-3 text-sm text-zinc-300">{latest?.name || latest?.label}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to={resumeUrl}><Button variant="primary" size="lg" icon={<Play className="size-5" />}>Resume</Button></Link>
          <Link to={`/play/${game.id}`}><Button variant="glass" size="lg">Main menu</Button></Link>
          <Link to={`/game/${game.id}`}><Button variant="glass" size="lg">Details</Button></Link>
        </div>
      </div>
    </section>
  )
}

export default function Library() {
  const { data: games, isLoading, error } = useGames()
  const { data: catalog } = useCatalog()
  const vocabulary = catalog?.vocabulary ?? {}
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const filter = params.get('filter') ?? 'all'
  const tag = params.get('tag')
  const sort = params.get('sort') ?? 'played'
  const update = (key: string, value: string | null) => {
    // Read the current URL so quick edits cannot restore an earlier navigation's filters.
    const next = new URLSearchParams(window.location.search)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  const [limit, setLimit] = useState(60)
  useEffect(() => setLimit(60), [q, filter, tag, sort])
  const shown = (games ?? []).filter((g) =>
    matchesSearch(g, q, vocabulary) &&
    (filter === 'all' || (filter === 'installed' ? g.status === 'installed' || g.job : g.status !== 'installed' && !g.job)) &&
    (!tag || gameTags(g, vocabulary).some((t) => t.id === tag)),
  ).sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title)
    if (sort === 'added') return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.title.localeCompare(b.title)
    return (Date.parse(b.lastPlayedAt ?? '') || 0) - (Date.parse(a.lastPlayedAt ?? '') || 0) || a.title.localeCompare(b.title)
  })
  const recent = (games ?? []).filter((g) => g.status === 'installed' && g.lastPlayedAt).sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!))[0]
  if (error) return <Empty title="Could not load the library">{String(error)}</Empty>
  return <div>
    {recent && !q && <Continue game={recent} />}
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <h1 className="mr-auto font-display text-2xl font-semibold text-white">Library</h1>
      <select aria-label="Filter games" value={filter} onChange={(e) => update('filter', e.target.value)} className="h-11 rounded-xl bg-ink-800 px-3 text-sm text-white"><option value="all">All</option><option value="installed">Installed</option><option value="not_installed">Not installed</option></select>
      <select aria-label="Sort games" value={sort} onChange={(e) => update('sort', e.target.value)} className="h-11 rounded-xl bg-ink-800 px-3 text-sm text-white"><option value="played">Last played</option><option value="title">Title</option><option value="added">Recently added</option></select>
      <input aria-label="Search your games" placeholder="Search your games" value={q} onChange={(e) => update('q', e.target.value)} className="h-11 w-full rounded-xl bg-white/5 px-4 text-sm text-white sm:w-64" />
    </div>
    <TagFilters tags={tagChips(games ?? [], vocabulary)} selected={tag} onSelect={(id) => update('tag', id)} />
    {shown.some((g) => g.favoriteAt) && <section className="mb-8"><h2 className="mb-4 text-lg font-semibold text-white">Favourites</h2><div className="flex gap-4 overflow-x-auto pb-3 sm:grid sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{shown.filter((g) => g.favoriteAt).map((g) => <div key={g.id} className="w-44 shrink-0 sm:w-auto"><GameCard game={g} /></div>)}</div></section>}
    {isLoading ? (
      <Spinner />
    ) : !games?.length ? (
      <EmptyLibrary recipes={catalog?.games ?? []} />
    ) : !shown.length ? (
      <Empty title="No games match">Try a different search or filter.</Empty>
    ) : (
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {shown.slice(0, limit).map((g, i) => <GameCard key={g.id} game={g} index={i} />)}
      </div>
    )}
    {shown.length > limit && <div className="mt-6 text-center"><Button onClick={() => setLimit(limit + 48)}>Show more</Button></div>}
  </div>
}
