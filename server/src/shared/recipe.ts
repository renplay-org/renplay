// The recipe format: what a catalog index and Your recipes say about a game. Nothing here reads
// files or the network, so the catalog, the art cache and the install all read recipes the same way.
/** The picture formats, SteamGridDB's: grid (cover), wide, hero (banner), logo and icon. */
export type ArtKind = 'grid' | 'wide' | 'hero' | 'logo' | 'icon'
export const ART_KINDS: readonly ArtKind[] = ['grid', 'wide', 'hero', 'logo', 'icon']

export interface RecipeArchive {
  name: string
  size?: number
  sha256?: string
  platform?: string
}

export type RecipeStatus = 'verified' | 'playable' | 'broken' | 'untested'

export interface RecipeRelease {
  version: string
  date?: string
  /** Version of the engine the game was made with (Ren'Py 8.2.1, Godot 4.6.2). */
  madeWith?: string
  /** Web runtime to build this release with (overrides the recipe's). */
  runtime?: string
  status: RecipeStatus
  archives: RecipeArchive[]
  verified?: { date?: string; renplay?: string; browsers?: string[]; notes?: string }
}

export interface RecipePatch {
  /** Destination inside the game, e.g. "game/zz_renplay_fix.rpy". */
  path: string
  /** URL relative to the catalog index, or absolute. */
  url: string
  sha256: string
}

export type GameState = 'ongoing' | 'completed' | 'on-hold' | 'abandoned'
export type Vocabulary = Record<string, { label: string; group: 'play' | 'story' | 'art' | 'protagonist' | 'content' }>

/** Archive names identify releases even when the game's internal version is unrelated. */
export function installedRelease(recipe: Recipe, version: string, archive?: string): RecipeRelease | null {
  const name = archive?.split('/').pop()
  return (name ? recipe.releases.find((r) => r.archives?.some((a) => a.name === name)) : undefined)
    ?? recipe.releases.find((r) => r.version === version) ?? null
}

export interface Recipe {
  id: string
  title: string
  developer?: string
  tags?: string[]
  tagIds?: string[]
  content?: string[]
  state?: GameState
  summary?: string
  nsfw?: boolean
  free?: boolean
  /** The game's pictures in SteamGridDB's formats (schema 4). A schema 3 cover becomes one grid. */
  art?: CatalogImage[]
  /** How the game plays on a phone, curated: great, playable, or desktop (needs a bigger screen). */
  phone?: 'great' | 'playable' | 'desktop'
  links?: Record<string, string>
  saveDir?: string
  /** Games whose saves this one imports (an earlier season, a prequel). */
  continuesFrom?: string[]
  /** Archive name patterns (with *) that belong to this game, for releases not listed yet. */
  match?: string[]
  /** What made the game. Ren'Py is what Renplay is for (docs.renplay.org/engines). */
  engine: 'renpy' | 'html' | 'godot' | 'unity'
  /** Web runtime to build with, from renplay-org/engines; default the newest that fits. */
  runtime?: string
  build?: {
    optimizeImages?: boolean
    imageQuality?: number
    /** Files (globs relative to game/) that go into game.zip instead of streaming. */
    keep?: string[]
    /** Files (globs relative to game/) left out of the build entirely. */
    exclude?: string[]
    patches?: RecipePatch[]
  }
  releases: RecipeRelease[]
  /** Index URL the recipe came from (for relative URLs). */
  _base?: string
  /** Its source: the configured catalog address, or 'local' for Your recipes. */
  _origin?: string
}

export interface BuildSettings {
  engine?: string
  quality?: number
  optimize?: boolean
  keep?: string[]
  exclude?: string[]
}

export interface RecipeMatch {
  recipe: Recipe
  /** The listed release, or null for a newer, unlisted version matched by pattern. */
  release: RecipeRelease | null
  /** sha256, or name and size, match a listed archive. */
  exact: boolean
}

/** A picture as the catalog's schema 4 index publishes it. */
export interface CatalogImage {
  kind: ArtKind
  url: string
  source: string
  sha256?: string
  width?: number
  height?: number
  thumbhash?: string
  tint?: string
  focal?: [number, number]
  dark?: boolean
  default?: boolean
  sgdb?: number
  asset?: string
  by?: string
  byUrl?: string
}

/**
 * Recipes in catalog schema 4 names. Schema 2 (and caches written by Renplay
 * 2.5 and older) called the runtime `engine` and a release's madeWith and
 * runtime `renpy` and `engine`; all of those were Ren'Py games. Schema 3 had
 * one `cover` instead of the `art` list: it becomes a grid, placed by the
 * making order like any picture of another shape.
 */
export function normalizeRecipe(g: any): Recipe {
  const old = typeof g.engine !== 'string' || /^\d/.test(g.engine)
  const { renpy: _r, engine: _e, cover, coverSfw: _s, ...rest } = g
  const fromCover = (): CatalogImage[] | undefined => {
    const c = typeof cover === 'string' ? { url: cover } : cover && typeof cover === 'object' && typeof cover.url === 'string' ? cover : null
    if (!c) return undefined
    return [{ kind: 'grid', url: c.url, source: 'developer', sha256: c.sha256, width: c.width, height: c.height, default: true }]
  }
  return {
    ...rest,
    art: Array.isArray(g.art) ? g.art : fromCover(),
    engine: old ? 'renpy' : g.engine,
    runtime: g.runtime ?? (old ? g.engine : undefined),
    releases: g.releases.map(({ renpy, engine, ...r }: any) => ({ ...r, madeWith: r.madeWith ?? renpy, runtime: r.runtime ?? engine })),
  }
}
