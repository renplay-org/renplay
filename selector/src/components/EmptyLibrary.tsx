import { useAuth } from '../lib/auth'
import { useState } from 'react'
import DocsLink from './DocsLink'
import { Link } from 'react-router-dom'
import type { Recipe } from '../lib/api'
import { useContent, useSetAdultGames, useSystem } from '../lib/queries'
import { Cover } from './GameCard'
import { Badge, Button, errorText, useToast } from './ui'

/** A fresh install asks once which games it shows; until then it shows safe-for-work games only. */
function ContentChoice() {
  const setAdultGames = useSetAdultGames()
  const toast = useToast()
  const [busy, setBusy] = useState('')
  const choose = async (mode: 'allow' | 'block') => {
    setBusy(mode)
    try {
      await setAdultGames(mode)
    } catch (e) {
      toast(errorText(e), 'error')
      setBusy('')
    }
  }
  const options = [
    { mode: 'allow' as const, title: 'Every game, including adult games', hint: 'This shows games for adults.' },
    { mode: 'block' as const, title: 'Safe-for-work games only', hint: 'Adult games are hidden and cannot be installed.' },
  ]
  return <section className="mx-auto max-w-3xl">
    <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">Which games should this Renplay show?</h1>
    <p className="mb-8 mt-3 text-zinc-400">This applies to everyone who uses this Renplay. You can change it later in Settings.</p>
    <p className="mb-4"><DocsLink path="guides/adding-games/">How to add games</DocsLink></p>
    <div className="grid gap-4 sm:grid-cols-2">{options.map((option) => <button key={option.mode} disabled={!!busy} onClick={() => void choose(option.mode)} className="min-h-11 rounded-2xl bg-white/5 p-6 text-left ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-60"><h2 className="font-semibold text-white">{option.title}</h2><p className="mt-2 text-sm text-zinc-400">{busy === option.mode ? 'Saving…' : option.hint}</p></button>)}</div>
  </section>
}

export default function EmptyLibrary({ recipes }: { recipes: Recipe[] }) {
  const { data: system } = useSystem()
  const { data: content } = useContent()
  const starter = recipes.find((game) => game.free === true && !game.nsfw && game.engine === 'renpy' && ['verified', 'playable'].includes(game.releases[0]?.status ?? ''))
  const links = starter?.links ?? {}
  const developer = links.itch ?? links.website ?? links.steam
  const source = links.itch ? 'itch.io' : 'the developer'
  const admin = useAuth().data?.user.role === 'admin'
  if (!admin) return <section className="p-6 text-zinc-300"><h1 className="text-2xl font-bold text-white">Your library is empty.</h1><p className="mt-3">Ask an admin to add a game.</p></section>
  if (content && !content.chosen) return <ContentChoice />
  return <section className="mx-auto max-w-3xl">
    <h1 className="font-display text-3xl font-bold text-white sm:text-4xl">Your library is empty.</h1>
    <p className="mb-8 mt-3 text-zinc-400">Let us fix that. Start with a story, or add a game you already have.</p>
    {starter && <div className="mb-6 grid gap-4 overflow-hidden rounded-3xl bg-white/[0.04] p-3 ring-1 ring-white/10 sm:grid-cols-[220px_1fr] sm:p-4"><Cover game={{ ...starter, cover: starter.cover ?? null }} className="aspect-[63/50]" /><div className="px-1 py-2"><p className="mb-3 text-sm text-accent-300">Start with a free game</p><h2 className="text-2xl font-semibold text-white">{starter.title}</h2><div className="my-3 flex gap-2"><Badge>Free</Badge><Badge>Safe for work</Badge></div><p className="text-sm leading-relaxed text-zinc-400">{starter.summary}</p><div className="mt-6 flex flex-wrap gap-3">{developer && <a href={developer} target="_blank" rel="noreferrer"><Button variant="primary">Get it on {source} ↗</Button></a>}<Link to="/add"><Button>Upload the zip</Button></Link></div></div></div>}
    <div className="grid gap-4 sm:grid-cols-2"><Link to="/add" className="rounded-2xl bg-white/5 p-6"><h2 className="font-semibold text-white">Upload a game you have</h2><p className="mt-2 text-sm text-zinc-400">Pick its normal PC download. Renplay prepares it for your browser.</p></Link><div className="rounded-2xl bg-white/5 p-6"><h2 className="font-semibold text-white">Copy it to the server</h2><p className="mt-2 text-sm text-zinc-400">Put downloads in the archives folder, then open Add games.</p><code className="mt-3 block break-all text-xs text-zinc-500">{system?.paths.archives}</code></div></div>
    <div className="mt-6 flex flex-wrap gap-6"><Link className="inline-flex min-h-11 items-center text-sm text-accent-300" to="/add">Browse the catalog →</Link><DocsLink path="guides/adding-games/">How to add games</DocsLink></div>
  </section>
}
