import { Link } from 'react-router-dom'
import type { Recipe } from '../lib/api'
import { useSystem } from '../lib/queries'
import { Cover } from './GameCard'
import { Badge, Button } from './ui'

export default function EmptyLibrary({ recipes }: { recipes: Recipe[] }) {
  const { data: system } = useSystem()
  const starter = recipes.find((game) => game.free === true && !game.nsfw && game.engine === 'renpy' && ['verified', 'playable'].includes(game.releases[0]?.status ?? ''))
  const links = starter?.links ?? {}
  const developer = links.itch ?? links.website ?? links.steam
  const source = links.itch ? 'itch.io' : 'the developer'
  return <section className="mx-auto max-w-3xl">
    <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">Your library is empty.</h1>
    <p className="mb-8 mt-3 text-zinc-400">Let us fix that. Start with a story, or add a game you already have.</p>
    {starter && <div className="mb-6 grid gap-4 overflow-hidden rounded-3xl bg-white/[0.04] p-3 ring-1 ring-white/10 sm:grid-cols-[220px_1fr] sm:p-4"><Cover game={{ ...starter, cover: starter.cover ?? null }} className="aspect-[63/50]" /><div className="px-1 py-2"><p className="mb-3 text-sm text-accent-300">Start with a free game</p><h2 className="text-2xl font-semibold text-white">{starter.title}</h2><div className="my-3 flex gap-2"><Badge>Free</Badge><Badge>Safe for work</Badge></div><p className="text-sm leading-relaxed text-zinc-400">{starter.summary}</p><div className="mt-6 flex flex-wrap gap-3">{developer && <a href={developer} target="_blank" rel="noreferrer"><Button variant="primary">Get it on {source} ↗</Button></a>}<Link to="/add"><Button>Upload the zip</Button></Link></div></div></div>}
    <div className="grid gap-4 sm:grid-cols-2"><Link to="/add" className="rounded-2xl bg-white/5 p-6"><h2 className="font-semibold text-white">Upload a game you have</h2><p className="mt-2 text-sm text-zinc-400">Pick its normal PC download. Renplay prepares it for your browser.</p></Link><div className="rounded-2xl bg-white/5 p-6"><h2 className="font-semibold text-white">Copy it to the server</h2><p className="mt-2 text-sm text-zinc-400">Put downloads in the archives folder, then open Add games.</p><code className="mt-3 block break-all text-xs text-zinc-500">{system?.paths.archives}</code></div></div>
    <Link className="mt-6 inline-flex min-h-11 items-center text-sm text-accent-300" to="/add">Browse the catalog →</Link>
  </section>
}
