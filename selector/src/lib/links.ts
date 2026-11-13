import { slotName } from './format'

/** Labels for recipe links, in display order. */
const LINK_LABELS: Record<string, string> = {
  website: 'Website',
  itch: 'Itch.io',
  patreon: 'Patreon',
  subscribestar: 'SubscribeStar',
  steam: 'Steam',
  f95: 'F95zone',
  discord: 'Discord',
  walkthrough: 'Guide',
}

export function recipeLinks(links: Record<string, string> | undefined): Array<[string, string, string]> {
  return Object.keys(LINK_LABELS)
    .filter((k) => links?.[k])
    .map((k) => [k, LINK_LABELS[k]!, links![k]!])
}

/** The address a game plays at, with the save to resume, if there is one. */
export function playLink(gameId: string, saveFile?: string | null): string {
  return saveFile ? `/play/${gameId}?resume=${encodeURIComponent(slotName(saveFile))}` : `/play/${gameId}`
}

/**
 * A small browser window beside the game, for a page that forbids framing (the catalog's guide link) or for the
 * guide popped out. It is sized like the guide's own window. Null when the browser refused it, and the caller
 * then lets the link do what it does.
 */
export function openPopup(url: string, size?: { w: number; h: number }): Window | null {
  const w = Math.round(size?.w ?? 620)
  const h = Math.round(size?.h ?? Math.min(780, window.screen.availHeight * 0.82))
  return window.open(url, 'renplay-guide', `popup,width=${w},height=${h}`)
}

/** A link's click that opens it in the popup, and lets the link be itself (a tab) when the browser does not allow one. */
export const popupClick = (url: string) => (e: { preventDefault: () => void; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return
  if (openPopup(url)) e.preventDefault()
}
