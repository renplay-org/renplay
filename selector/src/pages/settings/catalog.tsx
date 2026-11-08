import { ExternalLink, FileCode2, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import RecipeDialog from '../../components/RecipeDialog'
import { Button } from '../../components/ui'
import { post } from '../../lib/api'
import type { CatalogSource } from '@shared/api'
import { ago } from '../../lib/format'
import { useCatalog, useGames, useSystem } from '../../lib/queries'
import { setBy, useRun } from './common'

/** The catalog: where recipes come from, refreshing it, and a recipe for an installed game. */
export function CatalogPanel() {
  const { data: sys } = useSystem()
  const { data: catalog } = useCatalog()
  const { data: games } = useGames()
  const installed = (games ?? []).filter((g) => g.status === 'installed')
  const [recipeFor, setRecipeFor] = useState('')
  const recipeGame = installed.find((g) => g.id === recipeFor)
  const [recipeOpen, setRecipeOpen] = useState(false)
  const run = useRun()
  return (
    <>
      <section className="panel">
        <h2 className="h3" style={{ marginBottom: 6 }}>Catalog</h2>
        <p className="small muted">
          Titles, art and install settings come from {catalog?.status.count ?? 0} recipes in the catalog{catalog?.status.fetchedAt ? `, updated ${ago(catalog.status.fetchedAt, true)}` : ''}.
        </p>
        {catalog?.status.sources && <CatalogSources sources={catalog.status.sources} label={(s) => setBy(sys, s.kind === 'folder' ? 'RENPLAY_RECIPES_DIR' : 'RENPLAY_CATALOG_URLS')} />}
        <div className="actions" style={{ marginTop: 12 }}>
          <Button size="sm" icon={<RefreshCw />} onClick={() => run(() => post('/api/catalog/refresh'), 'Catalog refreshed')}>
            Refresh catalog
          </Button>
          <Button size="sm" variant="ghost" icon={<ExternalLink />} href="https://renplay.org/github/catalog" target="_blank" rel="noreferrer">
            Catalog on GitHub
          </Button>
        </div>
        {installed.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 14 }}>
            <p className="small muted" style={{ marginBottom: 10 }}>Add a game to the catalog: export a recipe filled in from its installation, then open a pull request, or keep it in Your recipes.</p>
            <div className="actions">
              <select aria-label="Choose a game" value={recipeFor} onChange={(e) => setRecipeFor(e.target.value)} className="input" style={{ maxWidth: 280 }}>
                <option value="">Choose a game</option>
                {installed.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
              <Button size="sm" icon={<FileCode2 />} disabled={!recipeGame} onClick={() => setRecipeOpen(true)}>
                Export recipe
              </Button>
            </div>
          </div>
        )}
      </section>
      {recipeOpen && recipeGame && <RecipeDialog game={recipeGame} onClose={() => setRecipeOpen(false)} />}
    </>
  )
}

/** Where recipes come from: each catalog, then Your recipes, with what each gives this person. */
function CatalogSources({ sources, label }: { sources: CatalogSource[]; label: (s: CatalogSource) => ReactNode }) {
  const name = (s: CatalogSource) => {
    if (s.kind === 'folder') return 'Your recipes'
    try {
      const u = new URL(s.location)
      return u.hostname === 'catalog.renplay.org' ? 'The Renplay catalog' : u.hostname
    } catch {
      return s.location
    }
  }
  return (
    <div className="list tight" style={{ marginTop: 12 }}>
      {sources.map((s) => (
        <div key={s.kind + s.location} className="stack" style={{ gap: 4, padding: '8px 0' }}>
          <div className="row between wrap" style={{ gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{name(s)}</span>
            <span className="small muted tnum">
              {s.recipes} {s.recipes === 1 ? 'recipe' : 'recipes'}, {s.pictures} {s.pictures === 1 ? 'picture' : 'pictures'}
            </span>
          </div>
          {label(s)}
          {s.kind === 'folder' ? (
            <p className="xs muted">
              Recipe files in <code>{s.location}</code>, in the catalog’s format. A recipe there takes the place of the catalog’s recipe with the same id, so you can fix a game or add one without waiting for the catalog.
            </p>
          ) : (
            <p className="xs muted truncate">{s.location}</p>
          )}
          {s.problems.length > 0 && (
            <details className="xs">
              <summary className="amber" style={{ minHeight: 'var(--hit)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                {s.problems.length} {s.problems.length === 1 ? 'problem' : 'problems'}
              </summary>
              <ul className="stack" style={{ gap: 4, paddingLeft: 16 }}>
                {s.problems.map((p) => (
                  <li key={p} className="muted">
                    {p}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  )
}
