import { Check, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Game } from '@shared/api'
import { recipeLinks } from '../lib/links'

export default function UpdateCard({ game }: { game: Game }) {
  const broken = game.recipe?.status === 'broken'
  const update = game.update
  return (
    <section id="update" className="panel">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className={`ic-sq ${broken || update ? 'amber' : 'green'}`} style={{ borderRadius: 12, background: 'var(--plate-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, flex: 'none' }}>
          {broken || update ? <Sparkles style={{ width: 20, height: 20 }} /> : <Check style={{ width: 20, height: 20 }} />}
        </span>
        <div className="grow">
          <h2 className="h3">{broken ? 'This version does not work in Renplay' : update ? 'Update available' : game.recipe ? 'Up to date' : 'Not in the catalog yet'}</h2>
          <p className="small muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
            {update
              ? `${update.version} is out. Get it from the developer and add the download. Your saves carry over.`
              : broken
                ? 'Check the developer’s downloads for a newer version. Your saves are kept.'
                : game.recipe
                  ? `${game.version ?? 'Your version'} is the newest release the catalog has tested.`
                  : 'Title and art arrive when a recipe exists.'}
          </p>
          {update?.archives?.length ? <p className="xs muted" style={{ marginTop: 8, overflowWrap: 'anywhere' }}>Download: {update.archives.join(' or ')}</p> : null}
          {update && (
            <div className="actions" style={{ marginTop: 12 }}>
              {recipeLinks(game.recipe?.links)
                .filter(([key]) => key !== 'walkthrough')
                .slice(0, 2)
                .map(([key, label, url]) => (
                  <a key={key} href={url} target="_blank" rel="noreferrer" className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                    Get it from {label} ↗
                  </a>
                ))}
              <Link to="/add" className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                Add the download
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
