import type { Game } from '@shared/api'

/** What this browser keeps about the guide: the window, the see-through, and per file the page and zoom. */

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 'fit' fills the window's width. A number is that share of the page's natural size, 1 being 100 percent. */
export type Zoom = 'fit' | number

export interface View {
  /** The page at the top, counted from 0. */
  page: number
  zoom: Zoom | null
}

/** The window's see-through and place: closing and opening it again changes nothing. `opacity` is what 4.10 kept. */
const WINDOW = 'renplay:guide-window'
interface Kept {
  seeThrough?: boolean
  opacity?: string
  box?: Box
}
const read = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
  } catch {
    return fallback
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing without storage: the window starts as new next time.
  }
}

export const keptBox = (): Box | undefined => read<Kept>(WINDOW, {}).box
/** On when it was chosen. The three steps of 4.10 (solid, 85, 70) map to off for solid and on for the others. */
export const keptSeeThrough = (): boolean => {
  const kept = read<Kept>(WINDOW, {})
  return kept.seeThrough ?? (kept.opacity !== undefined && kept.opacity !== '1')
}
export const keep = (change: Pick<Kept, 'seeThrough' | 'box'>) => write(WINDOW, { ...read<Kept>(WINDOW, {}), ...change })

/** The guide file a game last had open in this browser, when the game still has it. */
export const keptFile = (game: Game): string | null => {
  let file: string | null = null
  try {
    file = localStorage.getItem(`renplay:guide-file:${game.id}`)
  } catch {
    // Storage off: the first file.
  }
  return game.walkthroughs.find((w) => w.file === file)?.file ?? game.walkthroughs[0]?.file ?? null
}
export const keepFile = (game: Game, file: string) => {
  try {
    localStorage.setItem(`renplay:guide-file:${game.id}`, file)
  } catch {
    // Storage off.
  }
}

/** Where a file was left, so a guide reopens at the page and zoom it had. */
export const keptView = (file: string): View => {
  const v = read<Partial<View>>(`renplay:guide-view:${file}`, {})
  return { page: Number.isInteger(v.page) && v.page! >= 0 ? v.page! : 0, zoom: v.zoom === 'fit' || (typeof v.zoom === 'number' && v.zoom > 0) ? v.zoom : null }
}
export const keepView = (file: string, view: View) => write(`renplay:guide-view:${file}`, view)
