import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import GameCard from '../components/GameCard'
import EmptyLibrary from '../components/EmptyLibrary'
import ChipRow from '../components/ChipRow'
import UpNext from '../components/UpNext'
import Shelf from '../components/Shelf'
import UpdateCard from '../components/UpdateCard'
import SegmentedControl from '../components/SegmentedControl'
import SortMenu from '../components/SortMenu'
import { Button, Empty, errorText, useToast } from '../components/ui'
import { post } from '../lib/api'
import { useCatalog, useGames, useJobs } from '../lib/queries'
import { gameTags, matchesSearch, tagChips } from '../lib/tags'

export default function Library() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: games, isLoading, error, refetch } = useGames()
  const { data: catalog } = useCatalog()
  const { data: jobs } = useJobs()
  const vocabulary = catalog?.vocabulary ?? {}
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const filter = params.get('filter') ?? 'all'
  const tag = params.get('tag')
  const sort = params.get('sort') ?? 'recent'
  const update = (key: string, value: string | null) => {
    const next = new URLSearchParams(window.location.search)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }
  const [limit, setLimit] = useState(60)
  useEffect(() => setLimit(60), [q, filter, tag, sort])
  const all = games ?? []
  const failed = (jobs?.jobs ?? []).filter((job) => job.type === 'import' && ['failed', 'interrupted'].includes(job.status) && jobs?.jobs.find((other) => other.type === 'import' && other.game === job.game)?.id === job.id && !all.find((game) => game.id === job.game)?.job).filter((job, index, rows) => rows.findIndex((other) => other.game === job.game) === index)
  const shown = all.filter((g) =>
    matchesSearch(g, q, vocabulary) &&
    (filter === 'all' || (filter === 'favorites' ? !!g.favoriteAt : filter === 'added' ? !g.lastPlayedAt && g.status === 'installed' && !g.job && Date.now() - Date.parse(g.createdAt) < 7 * 86400000 : filter === 'failed' ? failed.some((job) => job.game === g.id) : filter === 'installed' ? g.status === 'installed' || g.job : g.status !== 'installed' && !g.job)) &&
    (!tag || gameTags(g, vocabulary).some((t) => t.id === tag)),
  ).sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title)
    if (sort === 'added') return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.title.localeCompare(b.title)
    const time = (g: typeof a) => sort === 'recent' ? Math.max(Date.parse(g.lastPlayedAt ?? '') || 0, Date.parse(g.createdAt)) : Date.parse(g.lastPlayedAt ?? '') || 0
    return time(b) - time(a) || a.title.localeCompare(b.title)
  })
  const recent = all.filter((g) => g.status === 'installed' && !g.job && g.lastPlayedAt && !g.finishedAt).sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!))[0]
  const favorites = all.filter((g) => g.favoriteAt).sort((a, b) => b.favoriteAt!.localeCompare(a.favoriteAt!))
  const added = all.filter((g) => !g.lastPlayedAt && g.status === 'installed' && !g.job && Date.now() - Date.parse(g.createdAt) < 7 * 86400000).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const updates = all.filter((g) => g.update)
  const home = !q && !tag && filter === 'all'
  if (error) return <Empty title="Could not load the library" action={<Button onClick={() => void refetch()}>Retry</Button>}>{String(error)}</Empty>
  if (isLoading) return <div className="space-y-8"><div className="skeleton h-72 rounded-3xl" /><div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton aspect-[63/50] rounded-2xl" />)}</div></div>
  if (!all.length) return <EmptyLibrary recipes={catalog?.games ?? []} />
  return <div>
    {home && <>
      {recent && <UpNext game={recent} />}
      {!!updates.length && <section className="mb-8 space-y-2">{updates.slice(0, 2).map((game) => <UpdateCard key={game.id} game={game} compact />)}{updates.length > 2 && <Link className="inline-flex min-h-11 items-center text-sm text-zinc-400" to="/add">And {updates.length - 2} more →</Link>}</section>}
      <Shelf title="Favourites" count={favorites.length} href="/?filter=favorites">{favorites.slice(0, 12).map((g) => <GameCard key={g.id} game={g} />)}</Shelf>
      <Shelf title={added.every((g) => new Date(g.createdAt).toDateString() === new Date().toDateString()) ? 'Added today' : 'Added this week'} count={added.length} href="/?filter=added&sort=added">{added.slice(0, 12).map((g) => <GameCard key={g.id} game={g} />)}</Shelf>
      <Shelf title="Not finished installing" count={failed.length} href="/?filter=failed">{failed.slice(0, 12).map((job) => <div key={job.id} className="rounded-2xl bg-white/5 p-4"><p className="font-semibold text-white">{all.find((g) => g.id === job.game)?.title || job.game || 'Install interrupted'}</p><p className="my-3 line-clamp-3 text-sm text-zinc-400">{job.error || 'The install was interrupted. Your saves are kept.'}</p><Button onClick={async () => { try { await post(`/api/jobs/${job.id}/retry`); void qc.invalidateQueries({ queryKey: ['jobs'] }); void qc.invalidateQueries({ queryKey: ['games'] }) } catch (error) { toast(errorText(error), 'error') } }}>Retry</Button></div>)}</Shelf>
    </>}
    <h2 className="mb-4 font-display text-2xl font-semibold text-white">All games <span className="text-base font-normal text-zinc-500">{all.length}</span></h2>
    <div className="sticky top-14 sm:top-16 z-20 -mx-1 mb-5 bg-ink-950/95 px-1 py-2 backdrop-blur-xl">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SegmentedControl value={filter} onChange={(value) => update('filter', value)} options={[{ value: 'all', label: 'All' }, { value: 'installed', label: 'Installed' }, { value: 'not_installed', label: 'Not installed' }]} />
        <SortMenu value={sort} onChange={(value) => update('sort', value)} />
        <input aria-label="Search your games" placeholder="Search your games" value={q} onChange={(e) => update('q', e.target.value)} className="h-11 min-w-0 flex-1 rounded-xl bg-white/5 px-4 text-sm text-white" />
      </div>
      <ChipRow tags={tagChips(all, vocabulary)} selected={tag} onSelect={(id) => update('tag', id)} />
    </div>
    {!shown.length ? <Empty title="No games match" action={<Button onClick={() => setParams({})}>Clear filters</Button>}>Try a different search or filter.</Empty> : <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{shown.slice(0, limit).map((g, i) => <GameCard key={g.id} game={g} index={i} />)}</div>}
    {shown.length > limit && <div className="mt-6 text-center"><Button onClick={() => setLimit(limit + 48)}>Show more</Button></div>}
  </div>
}
