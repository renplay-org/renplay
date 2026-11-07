import type { Game, Vocabulary } from '../lib/api'
import { gameTags } from '../lib/tags'
import { TagPill } from '../lantern/controls'

export default function GameTags({ game, vocabulary, showContent = false }: { game: Game; vocabulary: Vocabulary; showContent?: boolean }) {
  const tags = gameTags(game, vocabulary)
  const primary = tags.filter((t) => t.group !== 'content').sort((a, b) => Number(!['play', 'story'].includes(a.group)) - Number(!['play', 'story'].includes(b.group)))
  const content = tags.filter((t) => t.group === 'content')
  return (
    <>
      <div className="row wrap" style={{ gap: 6 }}>
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
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {content.map((tag) => (
              <TagPill key={tag.id}>{tag.label}</TagPill>
            ))}
          </div>
        </details>
      )}
    </>
  )
}
