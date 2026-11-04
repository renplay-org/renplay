import { Link } from 'react-router-dom'
import type { Recipe } from '../lib/api'
import { Button, Empty } from './ui'

export default function EmptyLibrary({ recipes }: { recipes: Recipe[] }) {
  const starters = recipes.filter((game) => game.nsfw === false)
  if (!starters.length) return (
    <Empty title="Your library is empty" action={<Link to="/add"><Button variant="primary">Add games</Button></Link>}>
      Add a game’s PC download to start playing.
    </Empty>
  )
  return (
    <section>
      <h2 className="mb-4 text-xl text-white">Start with a free game</h2>
      {starters.map((game) => {
        const links = game.links ?? {}
        const developer = links.website ?? links.itch ?? links.steam ?? links.patreon ?? links.subscribestar
        return (
          <div key={game.id} className="mb-4 rounded-xl bg-white/5 p-4">
            <h3 className="font-semibold text-white">{game.title}</h3>
            {game.summary && <p className="mt-2 text-sm text-zinc-400">{game.summary}</p>}
            <div className="mt-3 flex flex-wrap gap-3">
              {developer && <a href={developer} target="_blank" rel="noreferrer"><Button>Developer page</Button></a>}
              <Link to="/add"><Button variant="primary">Add games</Button></Link>
            </div>
          </div>
        )
      })}
    </section>
  )
}
