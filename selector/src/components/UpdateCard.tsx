import { ArrowUpCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Game } from '../lib/api'
import { recipeLinks } from '../lib/links'

export default function UpdateCard({ game, compact = false }: { game: Game; compact?: boolean }) {
  const broken = game.recipe?.status === 'broken'
  const update = game.update
  return <div id={compact ? undefined : 'update'} className={`rounded-2xl ring-1 ${broken ? 'bg-amber-400/5 ring-amber-400/15' : update ? 'bg-accent-500/[0.07] ring-accent-500/20' : 'bg-white/[0.03] ring-white/10'} ${compact ? 'px-4 py-3' : 'p-5'}`}>
    {compact ? <Link to={`/game/${game.id}#update`} className="flex items-center gap-3 text-sm text-zinc-300"><ArrowUpCircle className="size-4 shrink-0 text-accent-300" /><span className="min-w-0 flex-1 truncate"><strong className="text-white">{game.title} {update?.version}</strong> is out. Get it from the developer and add the download; your saves carry over.</span></Link> : <><h2 className="mb-2 font-semibold text-white">{broken ? 'This version does not work in Renplay' : update ? 'Update available' : game.recipe ? 'Up to date' : 'Not in the catalog yet'}</h2><p className="text-sm leading-relaxed text-zinc-400">{update ? `${update.version} is out. Get it from the developer and add the download; your saves carry over.` : broken ? 'Check the developer’s downloads for a newer version. Your saves are kept.' : game.recipe ? 'You have the latest release in the catalog.' : 'Title and cover arrive when a recipe exists.'}</p>{update?.archives?.length ? <p className="mt-3 break-all text-xs text-zinc-500">Download: {update.archives.join(' or ')}</p> : null}{update && <div className="mt-4 flex flex-wrap gap-4 text-sm text-accent-300">{recipeLinks(game.recipe?.links).filter(([key]) => key !== 'walkthrough').slice(0, 2).map(([key, label, url]) => <a key={key} href={url} target="_blank" rel="noreferrer">Get it from {label} ↗</a>)}<Link to="/add">Add the download →</Link></div>}</>}
  </div>
}
