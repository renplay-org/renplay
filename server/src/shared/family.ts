import type { Family } from './api.js'

/** A Ren'Py game: its family is empty or renpy. */
export function isRenpy(game: { family?: string | null }): boolean {
  return !game.family || game.family === 'renpy'
}

/** The family of a game, as the API sends it. A row with no family is a Ren'Py game. */
export function toFamily(family: string | null | undefined): Family {
  return (family || 'renpy') as Family
}
