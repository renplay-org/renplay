import { useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Card from '../lantern/Tile'
import { Pill, Seg, TagPill } from '../lantern/controls'
import { useRoom } from '../lantern/Room'
import Sheet from '../lantern/Sheet'
import RecipeCard from '../components/RecipeCard'
import CatalogTags, { matchesTags, useTagPrefs } from '../components/CatalogTags'
import { Empty, Spinner, errorText } from '../lantern/ui'
import type { CatalogGame } from '@shared/api'
import { ago } from '../lib/format'
import { useAddress, useTypedField, withParams } from '../lib/address'
import { post } from '../lib/api'
import { useGrowingGrid } from '../lib/grow'
import { useCatalog } from '../lib/queries'
import { useAuth } from '../lib/auth'
import { matchesSearch, stateLabel } from '../lib/tags'

const REQUEST_URL = 'https://renplay.org/catalog/request'

/** One catalog entry: the grid tile with an In your library pill, opening the recipe sheet. */
function RecipeTile({ recipe: r, href, onOpen }: { recipe: CatalogGame; href: string; onOpen: () => void }) {
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
  const [refreshing, setRefreshing] = useState(false)
  const opened = useRef(false)
  const admin = useAuth().data?.user.role === 'admin'
  useRoom({ game: null, quiet: true })
  useEffect(() => {
    if (!gameId) opened.current = false
  }, [gameId])
  const all = data?.games ?? []
  const vocabulary = data?.vocabulary ?? {}
  // Search and the segment first, so the tag counts say how many of these games have each tag.
  const shown = all.filter((g) => matchesSearch(g, search, vocabulary) && (filter === 'all' || (filter === 'free' ? g.free === true || (g.free === undefined && g.nsfw === false) : g.state === 'completed')))
  const filtered = shown.filter((g) => matchesTags(g, tagPrefs, vocabulary))
  const rows = useGrowingGrid(`catalog:${search}|${filter}|${tagPrefs.include}|${tagPrefs.exclude}`, filtered.length)
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
      <div className="toolbar" style={{ marginTop: 14 }}>
        <input aria-label="Search the catalog" placeholder="Search the catalog" value={typed} onChange={(e) => setTyped(e.target.value)} className="input" />
        <Seg
          small
          value={filter}
          onChange={(value) => setAddress({ filter: value === 'all' ? null : value })}
          options={[
            { value: 'all', label: `All ${filtered.length}` },
            { value: 'free', label: 'Free' },
            { value: 'completed', label: 'Completed' },
          ]}
        />
      </div>
      <CatalogTags
        games={shown}
        vocabulary={vocabulary}
        prefs={tagPrefs}
        onChange={setTagPrefs}
      />
      {!filtered.length ? (
        <Empty title="No games match" action={<Pill onClick={() => { setAccountTags({ include: [], exclude: [] }); setAddress({ q: null, filter: null, with: null, without: null }) }}>Clear filters</Pill>}>
          Nothing in the catalog matches. Try a different search or tag.
        </Empty>
      ) : (
        <>
          <div className="grid" data-row ref={rows.grid}>
            {filtered.slice(0, rows.shown).map((r) => (
              <RecipeTile
                key={r.id}
                recipe={r}
                href={addressOf({ game: r.id })}
                onOpen={() => {
                  opened.current = true
                  navigate(addressOf({ game: r.id }))
                }}
              />
            ))}
          </div>
          {rows.more && <div ref={rows.end} aria-hidden="true" />}
        </>
      )}
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
