import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Game } from '@shared/api'
import { post } from '../lib/api'
import { recipeLinks } from '../lib/links'

/**
 * The one place an update is announced: only for a newer release or an installed version marked broken.
 * Not now silences the catalog's current version for this person on every device, and a newer one brings it back.
 */
export default function UpdateCard({ game }: { game: Game }) {
  const qc = useQueryClient()
  const broken = game.recipe?.status === 'broken'
  const update = game.update
  if (!broken && (!update || game.updateDismissed)) return null
  const notNow = async () => {
    await post(`/api/games/${game.id}/update-not-now`)
    void qc.invalidateQueries({ queryKey: ['game', game.id] })
    void qc.invalidateQueries({ queryKey: ['games'] })
  }
  return (
    <section id="update" className="panel">
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span className="ic-sq amber" style={{ borderRadius: 12, background: 'var(--plate-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, flex: 'none' }}>
          <Sparkles style={{ width: 20, height: 20 }} />
        </span>
        <div className="grow">
          <h2 className="h3">{broken ? 'This version does not work in Renplay' : 'Update available'}</h2>
          <p className="small muted" style={{ marginTop: 6, lineHeight: 1.55 }}>
            {update ? `${update.version} is out. Get it from the developer and add the download. Your saves carry over.` : 'Check the developer’s downloads for a newer version. Your saves are kept.'}
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
              <button type="button" className="link-q small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} onClick={() => void notNow()}>
                Not now
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
