import { useQueryClient } from '@tanstack/react-query'
import { Heart, Play, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Card from '../lantern/Tile'
import Stage, { travelToDoor } from '../lantern/Stage'
import { Pill, TagPill, Seg, Bar } from '../lantern/controls'
import { useRoom } from '../lantern/Room'
import { useHidden } from '../lantern/art'
import EmptyLibrary from '../components/EmptyLibrary'
import TagFilters from '../components/TagFilters'
import Shelf from '../components/Shelf'
import SortMenu from '../components/SortMenu'
import { Button, Empty, errorText, useToast } from '../components/ui'
import { del, post, slotName, type Game } from '../lib/api'
import { ago, capitalize, pct, playedTime } from '../lib/format'
import { useCatalog, useGames, useJobs } from '../lib/queries'
import { gameTags, matchesSearch, tagChips } from '../lib/tags'

/** The one meta line under a tile: heart, Beta, when it was played. */
function tileMeta(g: Game) {
  if (g.job) return <span>Installing</span>
  if (g.status !== 'installed') return <span>Not installed</span>
  return (
    <>
      {g.favoriteAt && <Heart fill="currentColor" className="pink" />}
      {g.family !== 'renpy' && <span className="vio">Beta</span>}
      <span className="truncate">{g.lastPlayedAt ? capitalize(ago(g.lastPlayedAt)) : 'Not played yet'}</span>
    </>
  )
}

/** Corner pills and the install bar inside a tile's frame. */
function tileExtra(g: Game) {
  const parts: ReactNode[] = []
  if (g.update && !g.job) parts.push(
    <span key="up" className="corner">
      <TagPill tone="dark">Update</TagPill>
    </span>,
  )
  if (g.job)
    parts.push(
      <div key="job" className="prog">
        <div className="row between">
          <span className="truncate">{g.job.status === 'queued' ? 'Queued' : g.job.stage || 'Working'}</span>
          <span className="tnum">{g.job.status === 'running' ? pct(g.job.progress) : ''}</span>
        </div>
        <Bar thin value={g.job.progress} />
      </div>,
    )
  return parts.length ? <>{parts}</> : undefined
}

export function GameTile({ game, kind = 'grid', on, onFocus, onMouseEnter }: { game: Game; kind?: 'grid' | 'wide'; on?: boolean; onFocus?: () => void; onMouseEnter?: () => void }) {
  const installed = game.status === 'installed'
  return <Card game={game} kind={kind} href={`/game/${game.id}`} meta={tileMeta(game)} extra={tileExtra(game)} dim={!installed && !game.job} on={on} onFocus={onFocus} onMouseEnter={onMouseEnter} />
}

function resumeUrl(g: Game): string {
  return `/play/${g.id}${g.latestSave ? `?resume=${encodeURIComponent(slotName(g.latestSave.file))}` : ''}`
}

/** The stage's line about where you are: one line on a wide screen, two short lines on a phone. */
function stageMeta(g: Game) {
  const save = g.latestSave
  const played = !!save || g.saves.count > 0 || !!g.lastPlayedAt
  const rest = [playedTime(g.playTime, played), g.rating ? '★'.repeat(g.rating) : '', g.saves.count > 0 ? `${g.saves.count} ${g.saves.count === 1 ? 'save' : 'saves'}` : ''].filter(Boolean)
  return (
    <span className="meta-lines">
      {save && (
        <>
          <span>
            {save.label} · {ago(save.ctime)}
          </span>
          <span className="sep">·</span>
        </>
      )}
      <span aria-label={g.rating ? `${rest.join(', ')}, rated ${g.rating} of 5` : undefined}>{rest.join(' · ')}</span>
    </span>
  )
}

/** Resume, the game page, and Not now, which takes the game out of Up next until it is played again. */
function StageActions({ g }: { g: Game }) {
  const hidden = useHidden(g)
  const qc = useQueryClient()
  const toast = useToast()
  const notNow = async () => {
    try {
      await post(`/api/games/${g.id}/not-now`)
      await qc.invalidateQueries({ queryKey: ['games'] })
      toast(
        <>
          {g.title} left Up next until you play it again.{' '}
          <button className="link" onClick={() => void del(`/api/games/${g.id}/not-now`).then(() => qc.invalidateQueries({ queryKey: ['games'] }))}>
            Undo
          </button>
        </>,
      )
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  return (
    <>
      <Pill variant="p" size="lg" icon={<Play />} to={resumeUrl(g)} onClick={() => travelToDoor(g, hidden)}>
        {g.latestSave ? 'Resume' : 'Play'}
      </Pill>
      <Pill variant="s" size="lg" to={`/game/${g.id}`}>
        Game page
      </Pill>
      <Pill variant="q" size="lg" className="not-now" onClick={() => void notNow()}>
        Not now
      </Pill>
    </>
  )
}

/** The phone stage carousel: one stage per game up next, the next one peeking. The room follows the snapped slide. */
function StageCarousel({ games, onSlide }: { games: Game[]; onSlide: (id: string) => void }) {
  return (
    <div
      className="carousel"
      onScroll={(e) => {
        const el = e.currentTarget
        const slideW = el.scrollWidth / games.length
        const i = Math.round(el.scrollLeft / slideW)
        const g = games[Math.max(0, Math.min(games.length - 1, i))]
        if (g) onSlide(g.id)
      }}
    >
      {games.map((g) => (
        <div key={g.id} className="slide">
          <Stage game={g} eyebrow="Up next" meta={stageMeta(g)} actions={<StageActions g={g} />} />
        </div>
      ))}
    </div>
  )
}

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
  const failed = (jobs?.jobs ?? [])
    .filter((job) => job.type === 'import' && ['failed', 'interrupted'].includes(job.status) && jobs?.jobs.find((other) => other.type === 'import' && other.game === job.game)?.id === job.id && !all.find((game) => game.id === job.game)?.job)
    .filter((job, index, rows) => rows.findIndex((other) => other.game === job.game) === index)
  const shown = all
    .filter(
      (g) =>
        matchesSearch(g, q, vocabulary) &&
        (filter === 'all' ||
          (filter === 'favorites' ? !!g.favoriteAt : filter === 'added' ? !g.lastPlayedAt && g.status === 'installed' && !g.job && Date.now() - Date.parse(g.createdAt) < 7 * 86400000 : filter === 'failed' ? failed.some((job) => job.game === g.id) : filter === 'installed' ? g.status === 'installed' || g.job : g.status !== 'installed' && !g.job)) &&
        (!tag || gameTags(g, vocabulary).some((t) => t.id === tag)),
    )
    .sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title)
      if (sort === 'added') return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.title.localeCompare(b.title)
      if (sort === 'rating') return (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title)
      if (sort === 'time') return b.playTime - a.playTime || a.title.localeCompare(b.title)
      const time = (g: typeof a) => (sort === 'recent' ? Math.max(Date.parse(g.lastPlayedAt ?? '') || 0, Date.parse(g.createdAt)) : Date.parse(g.lastPlayedAt ?? '') || 0)
      return time(b) - time(a) || a.title.localeCompare(b.title)
    })
  // Up next: games in play. Stalled, Dropped and Finished retire a game, Not now hides it until it is played again.
  const upNext = all
    .filter((g) => g.status === 'installed' && !g.job && g.lastPlayedAt && !g.finishedAt && !['stalled', 'dropped', 'finished'].includes(g.playStatus ?? '') && !(g.notNowAt && g.notNowAt > g.lastPlayedAt))
    .sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!))
  const favorites = all.filter((g) => g.favoriteAt).sort((a, b) => b.favoriteAt!.localeCompare(a.favoriteAt!))
  const added = all.filter((g) => !g.lastPlayedAt && g.status === 'installed' && !g.job && Date.now() - Date.parse(g.createdAt) < 7 * 86400000).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  // A shelf of new games says something only while most of the library is not new.
  // And never when it holds the whole library: All games below shows the same.
  const addedShelf = added.length <= Math.max(4, all.length / 2) && added.length < all.length ? added : []
  // A failed install a person dismissed stays out of the way on this device.
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('renplay:dismissed-installs') ?? '[]')
    } catch {
      return []
    }
  })
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-100)
    setDismissed(next)
    try {
      localStorage.setItem('renplay:dismissed-installs', JSON.stringify(next))
    } catch {}
  }
  const failedShown = failed.filter((job) => !dismissed.includes(job.id))
  const updates = all.filter((g) => g.update)
  const home = !q && !tag && filter === 'all'

  // The stage game: the one the person is looking at in the Up next shelf, else the first.
  const [stageId, setStageId] = useState<string | null>(null)
  const stageGame = home ? (upNext.find((g) => g.id === stageId) ?? upNext[0]) : undefined
  useRoom({ game: stageGame ?? null, quiet: !stageGame })

  if (error)
    return (
      <Empty title="Could not load the library" action={<Button variant="primary" onClick={() => void refetch()}>Retry</Button>}>
        {String(error)}
      </Empty>
    )
  if (isLoading)
    return (
      <div className="stack" style={{ gap: 32 }}>
        <div className="skel" style={{ height: 300, borderRadius: 18 }} />
        <div className="grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skel" style={{ aspectRatio: '2/3' }} />
          ))}
        </div>
      </div>
    )
  if (!all.length) return <EmptyLibrary recipes={catalog?.games ?? []} />

  return (
    <div>
      {home && (
        <>
          {!!upNext.length && (
            <>
              <div className="hide-phone">
                <Stage game={stageGame!} eyebrow="Up next" meta={stageMeta(stageGame!)} actions={<StageActions g={stageGame!} />} />
              </div>
              <div className="hide-desk">
                <StageCarousel games={upNext} onSlide={setStageId} />
              </div>
            </>
          )}
          {!!upNext.length && (
            <Shelf title="Up next" count={upNext.length} wide>
              {upNext.map((g) => (
                <GameTile key={g.id} game={g} kind="wide" on={stageGame?.id === g.id} onFocus={() => setStageId(g.id)} onMouseEnter={() => setStageId(g.id)} />
              ))}
            </Shelf>
          )}
          {!!updates.length && (
            <div className="stack" style={{ marginTop: 22, gap: 10 }}>
              {updates.slice(0, 2).map((game) => (
                <div key={game.id} className="notice">
                  <Sparkles />
                  <div className="grow">
                    <b>
                      {game.title} {game.update!.version}
                    </b>{' '}
                    is out. Get it from the developer and add the download. Your saves carry over.
                  </div>
                  <Link className="link small" to={`/game/${game.id}#update`} style={{ flex: 'none', alignSelf: 'center' }}>
                    Details
                  </Link>
                </div>
              ))}
              {updates.length > 2 && (
                <Link className="link small" to="/add">
                  And {updates.length - 2} more
                </Link>
              )}
            </div>
          )}
          <Shelf title="Favourites" count={favorites.length} href="/?filter=favorites">
            {favorites.slice(0, 12).map((g) => (
              <GameTile key={g.id} game={g} />
            ))}
          </Shelf>
          <Shelf title={addedShelf.every((g) => new Date(g.createdAt).toDateString() === new Date().toDateString()) ? 'Added today' : 'Added this week'} count={addedShelf.length} href="/?filter=added&sort=added">
            {addedShelf.slice(0, 12).map((g) => (
              <GameTile key={g.id} game={g} />
            ))}
          </Shelf>
          <Shelf title="Not finished installing" count={failedShown.length} href="/?filter=failed">
            {failedShown.slice(0, 12).map((job) => (
              <div key={job.id} className="panel" style={{ width: 'calc(var(--tile-w) * 2 + var(--gap))', flex: 'none' }}>
                <p className="t" style={{ fontWeight: 650 }}>{all.find((g) => g.id === job.game)?.title || job.game || 'Install interrupted'}</p>
                <p className="small muted" style={{ margin: '8px 0 12px' }}>{job.error || 'The install was interrupted. Your saves are kept.'}</p>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await post(`/api/jobs/${job.id}/retry`)
                      void qc.invalidateQueries({ queryKey: ['jobs'] })
                      void qc.invalidateQueries({ queryKey: ['games'] })
                    } catch (error) {
                      toast(errorText(error), 'error')
                    }
                  }}
                >
                  Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={() => dismiss(job.id)}>
                  Dismiss
                </Button>
              </div>
            ))}
          </Shelf>
        </>
      )}
      <section className="sec">
        <div className="sec-h">
          <h2 className="h2">
            All games<span className="n">{all.length}</span>
          </h2>
          <Link to="/catalog">Find more in the catalog</Link>
        </div>
        <div className="toolbar">
          <Seg scroll value={filter} onChange={(value) => update('filter', value === 'all' ? null : value)} options={[{ value: 'all', label: 'All' }, { value: 'installed', label: 'Installed' }, { value: 'not_installed', label: 'Not installed' }]} />
          <SortMenu value={sort} onChange={(value) => update('sort', value === 'recent' ? null : value)} />
          <input aria-label="Search your games" placeholder="Search your games" value={q} onChange={(e) => update('q', e.target.value || null)} className="input" />
        </div>
        <TagFilters tags={tagChips(all, vocabulary)} selected={tag} onSelect={(id) => update('tag', id)} />
        {!shown.length ? (
          <Empty title="No games match" action={<Button onClick={() => setParams({})}>Clear filters</Button>}>
            Nothing in your library has every included tag without an excluded one.
          </Empty>
        ) : (
          <div className="grid" data-row>
            {shown.slice(0, limit).map((g) => (
              <GameTile key={g.id} game={g} />
            ))}
          </div>
        )}
        {shown.length > limit && (
          <div className="center" style={{ marginTop: 20 }}>
            <Button onClick={() => setLimit(limit + 48)}>
              Show more
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
