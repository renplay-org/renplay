import type { Game, Vocabulary } from '../lib/api'
import { gameTags } from '../lib/tags'
import { Badge } from './ui'

export default function GameTags({ game, vocabulary }: { game: Game; vocabulary: Vocabulary }) {
  const tags = gameTags(game, vocabulary)
  const primary = tags.filter((t) => t.group !== 'content').sort((a, b) => Number(!['play', 'story'].includes(a.group)) - Number(!['play', 'story'].includes(b.group)))
  const content = tags.filter((t) => t.group === 'content')
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {primary.map((tag) => (
          <span key={tag.id} className={['art', 'protagonist'].includes(tag.group) ? 'text-xs text-zinc-500' : 'text-xs text-zinc-200'}>{tag.label}</span>
        ))}
      </div>
      {content.length > 0 && (
        <details className="mt-3 text-xs text-zinc-400">
          <summary className="min-h-10 cursor-pointer py-2">Show content tags</summary>
          <div className="flex flex-wrap gap-2">{content.map((tag) => <Badge key={tag.id}>{tag.label}</Badge>)}</div>
        </details>
      )}
    </>
  )
}
