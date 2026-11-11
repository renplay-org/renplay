import { useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, RefreshCw } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Card from '../lantern/Tile'
import { Pill, Seg, TagPill } from '../lantern/controls'
import SearchField, { CountLine, Marked, Toolbar, useSearchScroll } from '../lantern/Search'
import { useRoom } from '../lantern/Room'
import Sheet from '../lantern/Sheet'
import RecipeCard from '../components/RecipeCard'
import CatalogTags, { matchesTags, useTagPrefs } from '../components/CatalogTags'
import { Empty, Spinner, errorText } from '../lantern/ui'
import type { CatalogGame } from '@shared/api'
import type { Vocabulary } from '@shared/recipe'
import { ago } from '../lib/format'
import { useAddress, useTypedField, withParams } from '../lib/address'
import { post } from '../lib/api'
import { useGrowingGrid } from '../lib/grow'
import { useCatalog } from '../lib/queries'
import { useAuth } from '../lib/auth'
import { createSearch, type Hit } from '../lib/search'
import { gameTags, stateLabel } from '../lib/tags'

const REQUEST_URL = 'https://renplay.org/catalog/request'

/** One catalog entry: the grid tile with an In your library pill, opening the recipe sheet. */
function RecipeTile({ recipe: r, hit, fade, href, onOpen }: { recipe: CatalogGame; hit?: Hit; fade: boolean; href: string; onOpen: () => void }) {
  const extra = r.local ? (
    <span className="corner">
      <TagPill tone="dark">
        <Check />
        <span className="lbl">In your library</span>
      </TagPill>
    </span>
  ) : undefined
  return (
    <Card
      game={r}
      gameId={r.local?.id}
      title={hit?.marks.length ? <Marked text={r.title} marks={hit.marks} /> : undefined}
      fade={fade}
      href={r.local ? `/game/${r.local.id}` : href}
      meta={
        <span className="truncate">
          {[r.developer, r.state && stateLabel[r.state]].filter(Boolean).join(' · ')}
          {r.engine && r.engine !== 'renpy' ? ' · Beta' : ''}
        </span>
      }
      extra={extra}
      // Not installed recipes open the sheet instead of travelling.
      onClick={r.local ? undefined : (e) => { e.preventDefault(); onOpen() }}
    />
  )
}

/** The tags in the address, `with` and `without`: a comma separated list each. */
const tagList = (value: string | null) => (value ? value.split(',').filter(Boolean) : [])
const NO_GAMES: CatalogGame[] = []
const NO_VOCABULARY: Vocabulary = {}

export default function Catalog() {
  const { data, isLoading, error, refetch } = useCatalog()
  const qc = useQueryClient()
  const [params, setAddress] = useAddress()
  const location = useLocation()
  const navigate = useNavigate()
  const [accountTags, setAccountTags] = useTagPrefs()
  const search = params.get('q') ?? ''
  const filter = params.get('filter') ?? 'all'
  const gameId = params.get('game')
  // The tags a person set are kept with their account, and the address carries them for this list.
  const tagPrefs = params.has('with') || params.has('without') ? { include: tagList(params.get('with')), exclude: tagList(params.get('without')) } : accountTags
  const setTagPrefs = (next: typeof tagPrefs) => {
    setAccountTags(next)
    setAddress({ with: next.include.join(',') || null, without: next.exclude.join(',') || null })
  }
  const [typed, setTyped] = useTypedField(search, (text) => setAddress({ q: text || null }))
  // The list follows what is typed a moment after the field itself (see the Library).
  const query = useDeferredValue(typed)
  const searching = query.trim() !== ''
  // Tiles that arrive after the person has started changing the list fade in. Those at the first load do not.
  const [live, setLive] = useState(false)
  useSearchScroll(searching, null)
  const [refreshing, setRefreshing] = useState(false)
  const opened = useRef(false)
  const admin = useAuth().data?.user.role === 'admin'
  useRoom({ game: null, quiet: true })
  useEffect(() => {
    if (!gameId) opened.current = false
  }, [gameId])
  const all = data?.games ?? NO_GAMES
  const vocabulary = data?.vocabulary ?? NO_VOCABULARY
  const finder = useMemo(() => createSearch(all, (g) => gameTags(g, vocabulary).map((t) => t.label)), [all, vocabulary])
  const hits = useMemo(() => finder.find(query), [finder, query])
  // Best match first while text is typed, and games of the same rank stay in the catalog's order.
  const found = hits ? all.filter((g) => hits.has(g)).sort((a, b) => hits.get(a)!.tier - hits.get(b)!.tier) : all
  // The tags, and then the segment: the All segment counts what the search and the tags leave.
  const tagged = found.filter((g) => matchesTags(g, tagPrefs, vocabulary))
  const filtered = tagged.filter((g) => filter === 'all' || (filter === 'free' ? g.free === true || (g.free === undefined && g.nsfw === false) : g.state === 'completed'))
  const active = searching || filter !== 'all' || tagPrefs.include.length > 0 || tagPrefs.exclude.length > 0
  // The list's growth belongs to the list, not to the words typed: it is kept while they change.
  const rows = useGrowingGrid(`catalog:${filter}|${tagPrefs.include}|${tagPrefs.exclude}`, filtered.length)
  const clearAll = () => {
    setLive(true)
    setTyped('')
    setAccountTags({ include: [], exclude: [] })
    setAddress({ q: null, filter: null, with: null, without: null })
  }
  if (isLoading) return <Spinner />
  if (error || !data)
    return (
      <Empty title="Could not load the catalog" action={<Pill onClick={() => void refetch()}>Retry</Pill>}>
        {errorText(error)}
      </Empty>
    )
  // An open game is a history entry of its own: the back button closes it.
  const sheet = all.find((r) => r.id === gameId)
  const addressOf = (changes: Record<string, string | null>) => `/catalog?${withParams(location.search, changes)}`
  const closeSheet = () => {
    if (opened.current) {
      opened.current = false
      navigate(-1)
    } else setAddress({ game: null })
  }
  return (
    <div>
      <div className="row between wrap" style={{ gap: 12 }}>
        <div>
          <h1 className="h1">Catalog</h1>
          <p className="lead" style={{ marginTop: 6 }}>
            Games tested in Renplay. Get one from its developer and add the download, Renplay recognizes it and uses the right settings.
          </p>
        </div>
        <div className="actions">
          {/* Refreshing the catalog is for admins. */}
          {admin && <Pill size="sm" loading={refreshing} icon={<RefreshCw />} onClick={async () => {
            setRefreshing(true)
            try {
              await post('/api/catalog/refresh')
              await refetch()
              void qc.invalidateQueries({ queryKey: ['archives'] })
            } finally {
              setRefreshing(false)
            }
          }}>
            Refresh
          </Pill>}
          <Pill variant="s" size="sm" href={REQUEST_URL} target="_blank" rel="noreferrer" icon={<ExternalLink />}>
            Request a game
          </Pill>
        </div>
      </div>
      {(() => {
        // A catalog that could not be read, or recipe files of your own with problems: said apart.
        const sources = data.status.sources
        const unreachable = sources ? sources.some((s) => s.kind === 'catalog' && s.problems.length > 0) : data.status.errors.length > 0
        const local = sources?.find((s) => s.kind === 'folder')?.problems.length ?? 0
        return (
          <>
            {unreachable && (
              <p className="small amber" style={{ marginTop: 10 }}>
                Could not reach the catalog. Last updated {ago(data.status.fetchedAt)}.
              </p>
            )}
            {local > 0 && (
              <p className="small amber" style={{ marginTop: 16 }}>
                {local === 1 ? 'A file in Your recipes has a problem' : `${local} files in Your recipes have problems`}. <Link to="/settings" className="link">Settings</Link> says which.
              </p>
            )}
          </>
        )
      })()}
      <Toolbar label="Search the catalog" wrap style={{ marginTop: 14 }}>
        <SearchField label="Search the catalog" placeholder="Title, developer or tag" value={typed} onChange={(text) => { setLive(true); setTyped(text) }} />
        <Seg
          small
          value={filter}
          onChange={(value) => { setLive(true); setAddress({ filter: value === 'all' ? null : value }) }}
          options={[
            { value: 'all', label: <span className="tnum">All {tagged.length}</span>, className: 'all' },
            { value: 'free', label: 'Free' },
            { value: 'completed', label: 'Completed' },
          ]}
        />
      </Toolbar>
      <CountLine shown={filtered.length} total={all.length} active={active} onClear={clearAll} />
      <div role="search" aria-label="Filter the catalog by tag">
        <CatalogTags games={filtered} all={all} vocabulary={vocabulary} prefs={tagPrefs} onChange={(next) => { setLive(true); setTagPrefs(next) }} />
      </div>
      <div className={`results ${active ? 'held' : ''}`.trim()}>
        <div className="grid" data-row ref={rows.grid}>
          {filtered.slice(0, rows.shown).map((r) => (
            <RecipeTile
              key={r.id}
              recipe={r}
              hit={hits?.get(r)}
              fade={live}
              href={addressOf({ game: r.id })}
              onOpen={() => {
                opened.current = true
                navigate(addressOf({ game: r.id }))
              }}
            />
          ))}
        </div>
        {rows.more && <div ref={rows.end} aria-hidden="true" />}
        {!filtered.length && (
          <Empty title="No games match" action={<Pill onClick={clearAll}>Clear filters</Pill>}>
            Nothing in the catalog matches. Try a different search or tag.
          </Empty>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 18 }}>
        Showing {rows.shown} of {filtered.length}
        {data.status.fetchedAt ? ` · Updated ${ago(data.status.fetchedAt, true)}` : ''}
      </p>
      {sheet && (
        <Sheet open onClose={closeSheet} wide>
          <RecipeCard recipe={sheet} />
        </Sheet>
      )}
    </div>
  )
}
