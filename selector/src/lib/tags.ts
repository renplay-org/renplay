import type { GameState, Vocabulary } from './api'
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
export function tagChips(games: Tagged[], vocabulary: Vocabulary) {
  const counts = new Map<string, { id: string; label: string; count: number }>()
  for (const game of games) for (const tag of gameTags(game, vocabulary)) {
    if (tag.group !== 'play' && tag.group !== 'story') continue
    const entry = counts.get(tag.id) ?? { id: tag.id, label: tag.label, count: 0 }
    entry.count++
    counts.set(tag.id, entry)
  }
  return [...counts.values()].filter((t) => t.count >= 2).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
export function matchesSearch(game: Tagged & { title: string; developer?: string | null }, search: string, vocabulary: Vocabulary) {
  return [game.title, game.developer ?? '', ...gameTags(game, vocabulary).map((t) => t.label)].join(' ').toLowerCase().includes(search.trim().toLowerCase())
}
