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
