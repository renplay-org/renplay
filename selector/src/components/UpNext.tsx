import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import { slotName, type Game } from '../lib/api'
import { ago } from '../lib/format'
import SceneCard from './SceneCard'
import { Button } from './ui'

export function playedTime(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m played` : `${minutes} m played`
}

export default function UpNext({ game }: { game: Game }) {
  const save = game.latestSave
  const url = `/play/${game.id}${save ? `?resume=${encodeURIComponent(slotName(save.file))}` : ''}`
  return <section className="mb-8 grid gap-4 overflow-hidden rounded-3xl bg-white/[0.04] p-3 ring-1 ring-white/10 sm:grid-cols-[minmax(0,460px)_1fr] sm:gap-7 sm:p-4">
    <Link to={url} aria-label={`Resume ${game.title}`}><SceneCard game={game} save={save} play className="h-full min-h-48" /></Link>
    <div className="flex flex-col justify-center px-1 pb-1 sm:py-2 sm:pr-6">
      <p className="mb-2 text-sm font-medium text-accent-300">Up next</p>
      <h1 className="font-display text-3xl font-bold text-white sm:text-5xl">{game.title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">{save ? `${save.label} · ${ago(save.ctime)} · ` : ''}{playedTime(game.playTime)} · {game.saves.count} saves</p>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        <Link to={url} className="col-span-2 [&>button]:w-full"><Button variant="primary" size="lg" icon={<Play className="size-5" />}>{save ? 'Resume' : 'Play'}</Button></Link>
        <Link to={`/play/${game.id}`} className="[&>button]:w-full"><Button>Main menu</Button></Link>
        <Link to={`/game/${game.id}`} className="[&>button]:w-full"><Button variant="ghost">Details</Button></Link>
      </div>
    </div>
  </section>
}
