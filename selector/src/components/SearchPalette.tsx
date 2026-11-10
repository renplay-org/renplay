import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useCatalog, useGames } from '../lib/queries'
import { matchesSearch } from '../lib/tags'
import { playLink } from '../lib/links'
import type { CatalogGame } from '@shared/api'
import RecipeCard from './RecipeCard'
import { Frame } from '../lantern/art'
import { cx } from '../lantern/ui'
import { isApple } from '../lib/platform'
import Sheet from '../lantern/Sheet'
import { IconBtn, Pill } from '../lantern/controls'

export default function SearchPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (isApple() ? e.metaKey : e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <>
      <button aria-keyshortcuts={isApple() ? 'Meta+K' : 'Control+K'} onClick={() => setOpen(true)} className="search">
        <Search />
        <span className="lbl">Search</span>
        <kbd aria-hidden="true">{isApple() ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <IconBtn label="Search" onClick={() => setOpen(true)} className="hide-desk">
        <Search />
      </IconBtn>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const { data: me } = useAuth(),
    { data: games, isError: gamesError } = useGames(),
    { data: catalog, isError: catalogError } = useCatalog(),
    navigate = useNavigate()
  const [query, setQuery] = useState(''),
    [active, setActive] = useState(0),
    [recipe, setRecipe] = useState<CatalogGame | null>(null)
  const list = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null)
  const go = (url: string) => {
    onClose()
    navigate(url)
  }
  const admin = me?.user.role === 'admin'
  const vocabulary = catalog?.vocabulary ?? {}
  const pages = [
    { title: 'Library', url: '/' },
    { title: 'Catalog', url: '/catalog' },
    ...(admin ? [{ title: 'Add games', url: '/add' }, { title: 'Activity', url: '/activity' }, { title: 'Users', url: '/settings/users' }] : []),
    { title: 'Settings', url: '/settings' },
    { title: 'Account', url: '/account' },
  ]
  const next = games?.filter((g) => g.status === 'installed' && g.lastPlayedAt && !g.finishedAt).sort((a, b) => (b.lastPlayedAt || '').localeCompare(a.lastPlayedAt || ''))[0]
  const results: { id: string; title: string; subtitle: string; action: () => void; cover?: Parameters<typeof Frame>[0]['game'] }[] = [
    ...(next ? [{ id: 'resume', title: `Resume ${next.title}`, subtitle: 'Action · Up next', action: () => go(playLink(next.id, next.latestSave?.file)) }] : []),
    ...pages.map((p) => ({ id: p.url, title: p.title, subtitle: p.url === '/add' ? 'Page · Add a game' : 'Page', action: () => go(p.url) })),
  ].filter((r) => `${r.title} ${r.subtitle}`.toLowerCase().includes(query.toLowerCase()))
  results.push(...(games ?? []).filter((g) => matchesSearch(g, query, vocabulary)).slice(0, 30).map((g) => ({ id: `game:${g.id}`, title: g.title, subtitle: `Library${g.developer ? ` · ${g.developer}` : ''}`, cover: g, action: () => go(`/game/${g.id}`) })))
  results.push(
    ...(catalog?.games ?? [])
      .filter((r) => !r.local && matchesSearch(r, query, vocabulary))
      .slice(0, 30)
      .map((r) => ({ id: `recipe:${r.id}`, title: r.title, subtitle: `Catalog${r.developer ? ` · ${r.developer}` : ''}`, cover: r, action: () => setRecipe(r) })),
  )
  const index = Math.min(active, Math.max(0, results.length - 1))
  useEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])
  return (
    <Sheet open onClose={onClose} title="Search Renplay">
      <div className="stack">
        {recipe ? (
          <>
            <Pill variant="q" size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setRecipe(null); requestAnimationFrame(() => input.current?.focus()) }}>
              Back to search results
            </Pill>
            <RecipeCard recipe={recipe} />
          </>
        ) : (
          <>
            <input
              ref={input}
              role="combobox"
              aria-label="Search games, catalog, pages and actions"
              aria-expanded
              aria-controls="search-results"
              aria-activedescendant={results.length ? `search-option-${index}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((index + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length))
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  results[index]?.action()
                }
              }}
              placeholder="Search titles, developers or tags"
              className="input"
            />
            {(gamesError || catalogError) && <p className="small amber">Some games could not be loaded. Pages are still available.</p>}
            <div ref={list} id="search-results" role="listbox" aria-label="Search results" className="stack" style={{ maxHeight: '55dvh', overflowY: 'auto', gap: 4 }}>
              {results.map((r, i) => (
                <button
                  id={`search-option-${i}`}
                  data-index={i}
                  key={r.id}
                  role="option"
                  aria-selected={index === i}
                  onClick={r.action}
                  onPointerMove={() => setActive(i)}
                  className={cx('row')}
                  style={{ minHeight: 56, borderRadius: 12, padding: '6px 10px', textAlign: 'left', background: index === i ? 'var(--plate-2)' : undefined }}
                >
                  {r.cover && <Frame game={r.cover} kind="sq" className="w-12 shrink-0" />}
                  <span className="grow">
                    <span className="truncate" style={{ display: 'block', fontWeight: 600 }}>
                      {r.title}
                    </span>
                    <span className="truncate small muted" style={{ display: 'block' }}>
                      {r.subtitle}
                    </span>
                  </span>
                </button>
              ))}
              {!results.length && <p className="small muted" style={{ padding: 12 }}>No matches. Try a title, developer or tag.</p>}
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
