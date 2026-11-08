import type { ArtKind } from './recipe.js'

/** Where a picture came from: a SteamGridDB author, a store, Renplay, the developer or an upload. */
export type ArtCredit = { by: string; byUrl?: string; asset?: string } | { store: 'Steam' | 'itch.io' } | { renplay: true } | { developer: true } | { upload: true }

/** How a format was made: null for real art in the shape. */
export type ArtMade = null | 'crop' | 'composed' | 'glow' | 'whole'

/**
 * One format, made by the server. Below Shown an adult game's formats carry only `thumbhash` and
 * `tint`: no address. A format not made yet has its source's hash and no address for a moment.
 */
export interface ArtFormat {
  url1x?: string | null
  url2x?: string | null
  width?: number
  height?: number
  thumbhash: string | null
  tint: string | null
  made?: ArtMade
  source?: string
  credit?: ArtCredit
  /** A dark logo, inverted on ink. */
  dark?: boolean
}

/** A game's five formats. */
export type ArtSet = Partial<Record<ArtKind, ArtFormat>>
