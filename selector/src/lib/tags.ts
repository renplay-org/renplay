import type { GameState, Vocabulary } from '@shared/recipe'
import { capitalize } from './format'

type Tagged = { tags?: string[]; tagIds?: string[]; content?: string[] }
export const stateLabel: Record<GameState, string> = { ongoing: 'Ongoing', completed: 'Completed', 'on-hold': 'On hold', abandoned: 'Abandoned' }

/** The curated phone rating, as the recipe schema words it. */
export const phoneLabel: Record<'great' | 'playable' | 'desktop', string> = { great: 'Great on phones', playable: 'Playable on phones', desktop: 'Needs a bigger screen' }
export function gameTags(game: Tagged, vocabulary: Vocabulary) {
  const ids = [...new Set([...(game.tagIds?.length ? game.tagIds : game.tags ?? []), ...(game.content ?? [])])]
  return ids.map((id) => {
    const entry = vocabulary[id] ?? Object.values(vocabulary).find((tag) => tag.label.toLowerCase() === id.toLowerCase())
    return { id, label: entry?.label ?? capitalize(id), group: entry?.group ?? (game.content?.includes(id) ? 'content' : game.tagIds?.length ? 'unknown' : 'story') }
  })
}
