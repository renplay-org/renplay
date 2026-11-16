import type { Game } from '@shared/api'
import type { Vocabulary } from '@shared/recipe'
import { gameTags } from '../lib/tags'

export default function GameTags({ game, vocabulary, showContent = false }: { game: Game; vocabulary: Vocabulary; showContent?: boolean }) {
  const tags = gameTags(game, vocabulary)
  const primary = tags.filter((t) => t.group !== 'content').sort((a, b) => Number(!['play', 'story'].includes(a.group)) - Number(!['play', 'story'].includes(b.group)))
  const content = tags.filter((t) => t.group === 'content')
  return (
    <>
      <div className="tags">
        {primary.map((tag) => (
          <span key={tag.id} className={['art', 'protagonist'].includes(tag.group) ? 'tag dim' : 'tag'}>
            {tag.label}
          </span>
        ))}
      </div>
      {showContent && content.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="small muted" style={{ minHeight: 40, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
            Show content tags
          </summary>
          <div className="tags" style={{ marginTop: 6 }}>
            {content.map((tag) => (
              <span key={tag.id} className="tag">{tag.label}</span>
            ))}
          </div>
        </details>
      )}
    </>
  )
}
