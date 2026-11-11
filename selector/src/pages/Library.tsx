import { useQueryClient } from '@tanstack/react-query'
import { Heart, Play, Sparkles, X } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Card from '../lantern/Tile'
import Stage, { travelToDoor, travelToPage } from '../lantern/Stage'
import { Chip, Pill, TagPill, Bar } from '../lantern/controls'
import Carousel from '../lantern/Carousel'
import SearchField, { Marked, Toolbar, countText, holdPlace, parkResults, useSearchScroll } from '../lantern/Search'
import { useRoom } from '../lantern/Room'
import { useHidden } from '../lantern/art'
import EmptyLibrary from '../components/EmptyLibrary'
import LibrarySkeleton, { rememberShape } from '../components/LibrarySkeleton'
import CatalogTags from '../components/CatalogTags'
import Shelf from '../components/Shelf'
import SortMenu from '../components/SortMenu'
import { Empty, errorText, useToast } from '../lantern/ui'
import { useAddress, useTypedField, withParams } from '../lib/address'
import { createSearch, type Hit } from '../lib/search'
import { del, post } from '../lib/api'
import { useGrowingGrid } from '../lib/grow'
import type { Game } from '@shared/api'
import type { Vocabulary } from '@shared/recipe'
import { ago, capitalize, jobStage, jobSubject, pct, playedTime } from '../lib/format'
import { playLink } from '../lib/links'
import { useCatalog, useGames, useJobs } from '../lib/queries'
import { gameTags } from '../lib/tags'
import { isRenpy } from '@shared/family'

/** The most games Up next shows. */
const UP_NEXT_MAX = 8

/** The shelves' See all links: what each list is called, for the chip that shows it and takes it off. */
const FILTERS: Record<string, string> = { favorites: 'Favourites', added: 'Added this week', failed: 'Not finished installing' }

/** The one meta line under a tile: heart, Beta, when it was played. */
function tileMeta(g: Game) {
  if (g.job) return <span>Installing</span>
  if (g.status !== 'installed') return <span>Not installed</span>
  return (
    <>
      {g.favoriteAt && <Heart fill="currentColor" className="pink" />}
      {!isRenpy(g) && <span className="vio">Beta</span>}
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
          <span className="truncate">{jobStage(g.job, 'Working')}</span>
          <span className="tnum">{g.job.status === 'running' ? pct(g.job.progress) : ''}</span>
        </div>
        <Bar thin value={g.job.progress} />
      </div>,
    )
  return parts.length ? <>{parts}</> : undefined
}

function GameTile({ game, hit, on, onFocus, onMouseEnter }: { game: Game; hit?: Hit; on?: boolean; onFocus?: () => void; onMouseEnter?: () => void }) {
  const installed = game.status === 'installed'
  const title = hit?.marks.length ? <Marked text={game.title} marks={hit.marks} /> : undefined
  return <Card game={game} href={`/game/${game.id}`} title={title} meta={tileMeta(game)} extra={tileExtra(game)} dim={!installed && !game.job} on={on} onFocus={onFocus} onMouseEnter={onMouseEnter} />
}

/** The tags in the address, a comma separated list: a game must have every one. */
const tagList = (value: string | null) => (value ? value.split(',').filter(Boolean) : [])
const NO_VOCABULARY: Vocabulary = {}
const NO_GAMES: Game[] = []

/** The order a list is in: `by` is one of the sort menu's values. */
function order(by: string): (a: Game, b: Game) => number {
  return (a, b) => {
    if (by === 'title') return a.title.localeCompare(b.title)
    if (by === 'added') return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.title.localeCompare(b.title)
    if (by === 'rating') return (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title)
    if (by === 'time') return b.playTime - a.playTime || a.title.localeCompare(b.title)
    const time = (g: Game) => (by === 'recent' ? Math.max(Date.parse(g.lastPlayedAt ?? '') || 0, Date.parse(g.createdAt)) : Date.parse(g.lastPlayedAt ?? '') || 0)
    return time(b) - time(a) || a.title.localeCompare(b.title)
  }
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
      <Pill variant="p" size="lg" icon={<Play />} to={playLink(g.id, g.latestSave?.file)} onClick={(e) => travelToDoor(g, hidden, e.currentTarget.closest('.stage')?.querySelector('.cover .frame'))}>
        {g.latestSave ? 'Resume' : 'Play'}
      </Pill>
      <Pill variant="s" size="lg" to={`/game/${g.id}`} onClick={(e) => travelToPage(g, hidden, e.currentTarget.closest('.stage')?.querySelector('.cover .frame'))}>
        Game page
      </Pill>
      <Pill variant="q" size="lg" className="not-now" onClick={() => void notNow()}>
        Not now
      </Pill>
    </>
  )
}

/** Up next: the games in play, one stage each, turning by itself (see Carousel). */
function UpNext({ games, onSlide }: { games: Game[]; onSlide: (id: string) => void }) {
  return <Carousel items={games} label="Up next" onSlide={(g) => onSlide(g.id)} slide={(g) => <Stage game={g} eyebrow="Up next" meta={stageMeta(g)} actions={<StageActions g={g} />} coverTo={`/game/${g.id}`} />} />
}

export default function Library() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: games, isLoading, error, refetch } = useGames()
  const { data: catalog } = useCatalog()
  const { data: jobs } = useJobs()
  const vocabulary = catalog?.vocabulary ?? NO_VOCABULARY
  const [params, setAddress] = useAddress()
  const q = params.get('q') ?? ''
  const asked = params.get('filter') ?? ''
  // Only the shelves' own lists: an old link to Installed or Not installed shows everything.
  const filter = asked in FILTERS ? asked : 'all'
  const tags = tagList(params.get('tag'))
  const sort = params.get('sort') ?? 'recent'
  const update = (key: string, value: string | null) => setAddress({ [key]: value })
  const [typed, setTyped] = useTypedField(q, (text) => update('q', text || null))
  // The list follows what is typed at once, a moment after the field itself (some browsers scroll to the caret
  // after the keystroke, and would scroll to where it was). Only the address waits for the person to pause.
  const query = useDeferredValue(typed)
  const searching = query.trim() !== ''
  // While a search is typed it is in best match order, unless the person picks another order for it.
  const [searchSort, setSearchSort] = useState<string | null>(null)
  const by = searching ? (searchSort ?? 'match') : sort
  const all = games ?? NO_GAMES
  const failed = (jobs?.jobs ?? [])
    .filter((job) => job.type === 'import' && ['failed', 'interrupted'].includes(job.status) && jobs?.jobs.find((other) => other.type === 'import' && other.game === job.game)?.id === job.id && !all.find((game) => game.id === job.game)?.job)
    .filter((job, index, rows) => rows.findIndex((other) => other.game === job.game) === index)
  const search = useMemo(() => createSearch(all, (g) => gameTags(g, vocabulary).map((t) => t.label)), [all, vocabulary])
  const hits = useMemo(() => search.find(query), [search, query])
  const shown = all
    .filter(
      (g) =>
        (!hits || hits.has(g)) &&
        (filter === 'all' ||
          (filter === 'favorites' ? !!g.favoriteAt : filter === 'added' ? !g.lastPlayedAt && g.status === 'installed' && !g.job && Date.now() - Date.parse(g.createdAt) < 7 * 86400000 : failed.some((job) => job.game === g.id))) &&
        (!tags.length || tags.every((id) => gameTags(g, vocabulary).some((t) => t.id === id))),
    )
    // Games of the same rank stay in the order the person chose.
    .sort(order(by === 'match' ? sort : by))
  if (by === 'match' && hits) shown.sort((a, b) => hits.get(a)!.tier - hits.get(b)!.tier)
  // The list's growth belongs to the list, not to the words typed: it is kept while they change.
  const rows = useGrowingGrid(`library:${filter}|${tags}|${sort}|${searchSort}`, shown.length)
  // Up next: games in play. Stalled, Dropped and Finished retire a game, Not now hides it until it is played again.
  const upNext = all
    .filter((g) => g.status === 'installed' && !g.job && g.lastPlayedAt && !g.finishedAt && !['stalled', 'dropped', 'finished'].includes(g.playStatus ?? '') && !(g.notNowAt && g.notNowAt > g.lastPlayedAt))
    .sort((a, b) => b.lastPlayedAt!.localeCompare(a.lastPlayedAt!))
    .slice(0, UP_NEXT_MAX)
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
  // A tag or a shelf's list is a filter, which Clear filters takes away. The search is not: it has its own clear button.
  const filtered = tags.length > 0 || filter !== 'all'
  const active = searching || filtered
  // The shelves are only for the plain library. While a search, a tag or a list is on they go, once the page has
  // scrolled them out of view, and the page keeps the toolbar where it is on the screen (see useSearchScroll).
  const home = !useSearchScroll(typed.trim() !== '' || filtered)
  useEffect(() => {
    if (games) rememberShape(upNext.length > 0)
  }, [games, upNext.length])

  // The stage game: the one the person is looking at in the Up next shelf, else the first.
  const [stageId, setStageId] = useState<string | null>(null)
  // The page's backdrop is the stage game's, and stays while the shelves are away for a search.
  const stageGame = upNext.find((g) => g.id === stageId) ?? upNext[0]
  useRoom({ game: stageGame ?? null, quiet: !stageGame })

  // A change of the list is made by the person, and the page keeps its place.
  const change = (apply: () => void) => {
    holdPlace()
    apply()
    parkResults()
  }
  const clearFilters = () => change(() => setAddress({ filter: null, tag: null }))
  const typeSearch = (text: string) => {
    if (!text.trim()) setSearchSort(null)
    setTyped(text)
  }
  const clearSearch = () => {
    holdPlace()
    typeSearch('')
    parkResults()
  }

  if (error)
    return (
      <Empty title="Could not load the library" action={<Pill variant="p" onClick={() => void refetch()}>Retry</Pill>}>
        {String(error)}
      </Empty>
    )
  if (isLoading) return <LibrarySkeleton />
  if (!all.length) return <EmptyLibrary recipes={catalog?.games ?? []} />

  return (
    <div>
      {home && (
        <>
          {!!upNext.length && <UpNext games={upNext} onSlide={setStageId} />}
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
                <p className="t" style={{ fontWeight: 650 }}>{jobSubject(job) || 'Install interrupted'}</p>
                <p className="small muted" style={{ margin: '8px 0 12px' }}>{job.error || 'The install was interrupted. Your saves are kept.'}</p>
                <Pill
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
                </Pill>
                <Pill size="sm" variant="q" onClick={() => dismiss(job.id)}>
                  Dismiss
                </Pill>
              </div>
            ))}
          </Shelf>
        </>
      )}
      <section className="sec">
        <div className="sec-h">
          <h2 className="h2">
            All games<span className="n tnum">{countText(shown.length, all.length, active)}</span>
          </h2>
          <Link to="/catalog">Find more in the catalog</Link>
        </div>
        <Toolbar label="Search your games">
          <SearchField label="Search your games" value={typed} onChange={typeSearch} count={{ shown: shown.length, total: all.length, narrowed: active }} />
          <SortMenu
            value={by}
            searching={searching}
            onChange={(value) => {
              if (searching) setSearchSort(value === 'match' ? null : value)
              else update('sort', value === 'recent' ? null : value)
            }}
          />
        </Toolbar>
        {filter in FILTERS && (
          <div className="chip-bar" style={{ marginBottom: 10 }}>
            <Chip on onClick={() => change(() => update('filter', null))} aria-label={`${FILTERS[filter]}, show all games`}>
              {FILTERS[filter]}
              <X aria-hidden="true" />
            </Chip>
          </div>
        )}
        <div role="search" aria-label="Filter your games by tag">
          <CatalogTags games={shown} all={all} vocabulary={vocabulary} prefs={{ include: tags, exclude: [] }} mode="include" onClear={filtered ? clearFilters : undefined} onChange={(next) => change(() => update('tag', next.include.join(',') || null))} />
        </div>
        <div className={`results ${active ? 'held' : ''}`.trim()}>
          <div className="grid" data-row ref={rows.grid}>
            {shown.slice(0, rows.shown).map((g) => (
              <GameTile key={g.id} game={g} hit={hits?.get(g)} />
            ))}
          </div>
          {rows.more && <div ref={rows.end} aria-hidden="true" />}
          {!shown.length && (
            <Empty
              title="No games match"
              action={
                <>
                  {filtered && <Pill onClick={clearFilters}>Clear filters</Pill>}
                  {searching && <Pill variant={filtered ? 'q' : 's'} onClick={clearSearch}>Clear the search</Pill>}
                  {searching && <Pill variant="q" to={`/catalog?${withParams('', { q: query.trim() })}`}>Search the catalog</Pill>}
                </>
              }
            >
              Nothing in your library matches. Try another search or tag.
            </Empty>
          )}
        </div>
      </section>
    </div>
  )
}
