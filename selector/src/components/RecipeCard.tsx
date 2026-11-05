import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Cover } from './GameCard'
import { Badge, BetaBadge } from './ui'
import type { Recipe } from '../lib/api'
import { stateLabel } from '../lib/tags'
import { recipeLinks } from '../lib/links'

export default function RecipeCard({ recipe: r }: { recipe: Recipe }) {
  const latest = r.releases[0]
  return (
    <div className="flex min-w-0 gap-3 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07] sm:gap-4">
      <Cover game={{ title: r.title, cover: typeof r.cover === 'string' ? r.cover : null, nsfw: r.nsfw, coverSfw: r.coverSfw }} rounded={false} className="aspect-[63/50] w-24 shrink-0 self-start rounded-xl sm:w-36" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-white">{r.title}</div>
        {r.developer && <div className="truncate text-xs text-zinc-400">{r.developer}</div>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {latest && <Badge>{latest.version}</Badge>}
          {r.state && <Badge>{stateLabel[r.state]}</Badge>}
          <BetaBadge engine={r.engine} />
          {latest?.status === 'broken' && <Badge tone="red">Does not work</Badge>}
          {r.local && <Link to={`/game/${r.local.id}`}><Badge tone="accent">In your library</Badge></Link>}
        </div>
        {r.summary && <p className="mt-2 line-clamp-2 text-sm text-zinc-400">{r.summary}</p>}
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
          {!r.local && recipeLinks(r.links).slice(0, 1).map(([k, label, url]) => <a key={k} href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 text-xs text-zinc-400 hover:text-white">Get it on {label} <ExternalLink className="size-3" /></a>)}
        </div>
      </div>
    </div>
  )
}
