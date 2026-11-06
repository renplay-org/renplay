import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useCatalog, useGames } from '../lib/queries'
import { matchesSearch } from '../lib/tags'
import { slotName, type Recipe } from '../lib/api'
import RecipeCard from './RecipeCard'
import { Cover } from './GameCard'
import { Modal, cx } from './ui'

export const applePlatform = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /iPhone|iPad/.test(navigator.userAgent)

export default function SearchPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'k' && (applePlatform() ? e.metaKey : e.ctrlKey)) { e.preventDefault(); setOpen(o => !o) } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [])
  return <><button aria-label="Search" onClick={() => setOpen(true)} className="flex min-h-11 min-w-11 items-center justify-center gap-3 rounded-xl bg-white/[0.04] px-3 text-sm text-zinc-400 ring-1 ring-white/10"><Search className="size-4" /><span className="hidden lg:inline">Search games and more</span><kbd className="hidden text-xs sm:inline">{applePlatform() ? '⌘K' : 'Ctrl+K'}</kbd></button>{open && <SearchDialog onClose={() => setOpen(false)} />}</>
}
function SearchDialog({ onClose }: { onClose: () => void }) {
  const { data: me } = useAuth(), { data: games, isError: gamesError } = useGames(), { data: catalog, isError: catalogError } = useCatalog(), navigate = useNavigate()
  const [query, setQuery] = useState(''), [active, setActive] = useState(0), [recipe, setRecipe] = useState<Recipe | null>(null)
  const list = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null)
  const go = (url: string) => { onClose(); navigate(url) }
  const admin = me?.user.role === 'admin'
  const vocabulary = catalog?.vocabulary ?? {}
  const pages = [{ title: 'Library', url: '/' }, ...(admin ? [{ title: 'Add games', url: '/add' }, { title: 'Activity', url: '/activity' }, { title: 'Users', url: '/settings/users' }] : []), { title: 'Settings', url: '/settings' }, { title: 'Account', url: '/account' }]
  const next = games?.filter(g => g.status === 'installed' && g.lastPlayedAt && !g.finishedAt).sort((a, b) => (b.lastPlayedAt || '').localeCompare(a.lastPlayedAt || ''))[0]
  const results: { id: string; title: string; subtitle: string; action: () => void; cover?: Parameters<typeof Cover>[0]['game'] }[] = [
    ...(next ? [{ id: 'resume', title: `Resume ${next.title}`, subtitle: 'Action · Up next', action: () => go(`/play/${next.id}${next.latestSave ? `?resume=${encodeURIComponent(slotName(next.latestSave.file))}` : ''}`) }] : []),
    ...pages.map(p => ({ id: p.url, title: p.title, subtitle: p.url === '/add' ? 'Page · Add a game' : 'Page', action: () => go(p.url) })),
  ].filter(r => `${r.title} ${r.subtitle}`.toLowerCase().includes(query.toLowerCase()))
  results.push(...(games ?? []).filter(g => matchesSearch(g, query, vocabulary)).slice(0, 30).map(g => ({ id: `game:${g.id}`, title: g.title, subtitle: `Library${g.developer ? ` · ${g.developer}` : ''}`, cover: g, action: () => go(`/game/${g.id}`) })))
  results.push(...(catalog?.games ?? []).filter(r => !r.local && matchesSearch(r, query, vocabulary)).slice(0, 30).map(r => ({ id: `recipe:${r.id}`, title: r.title, subtitle: `Catalog${r.developer ? ` · ${r.developer}` : ''}`, cover: { title: r.title, cover: r.cover ?? null, nsfw: r.nsfw }, action: () => setRecipe(r) })))
  const index = Math.min(active, Math.max(0, results.length - 1))
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' }) }, [index])
  return <Modal open onClose={onClose} title="Search Renplay"><div className="space-y-4">{recipe ? <><button className="min-h-11 text-sm text-accent-300" onClick={() => { setRecipe(null); requestAnimationFrame(() => input.current?.focus()) }}>← Search results</button><RecipeCard recipe={recipe} /></> : <>
    <input ref={input} autoFocus role="combobox" aria-label="Search games, catalog, pages and actions" aria-expanded aria-controls="search-results" aria-activedescendant={results.length ? `search-option-${index}` : undefined} value={query} onChange={e => { setQuery(e.target.value); setActive(0) }} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setActive((index + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length)) }; if (e.key === 'Enter') { e.preventDefault(); results[index]?.action() } }} placeholder="Search titles, developers or tags" className="h-12 w-full rounded-xl bg-white/5 px-4 text-sm text-white ring-1 ring-white/10" />
    {(gamesError || catalogError) && <p className="text-sm text-amber-200">Some games could not be loaded. Pages are still available.</p>}
    <div ref={list} id="search-results" role="listbox" aria-label="Search results" className="max-h-[55dvh] space-y-1 overflow-y-auto">{results.map((r, i) => <button id={`search-option-${i}`} data-index={i} key={r.id} role="option" aria-selected={index === i} onClick={r.action} onPointerMove={() => setActive(i)} className={cx('flex min-h-14 w-full items-center gap-3 rounded-xl p-3 text-left', index === i ? 'bg-white/10' : 'hover:bg-white/5')}>{r.cover && <Cover game={r.cover} className="aspect-square w-12 shrink-0" />}<span className="min-w-0"><span className="block truncate text-sm font-medium text-white">{r.title}</span><span className="block truncate text-xs text-zinc-400">{r.subtitle}</span></span></button>)}{!results.length && <p className="p-3 text-sm text-zinc-400">No matches. Try a title, developer or tag.</p>}</div>
  </>}</div></Modal>
}
