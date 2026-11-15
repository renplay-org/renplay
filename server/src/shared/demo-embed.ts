/** Accept one exact web origin, never a CSP source list, wildcard, path or credentials. */
export function demoEmbedderOrigin(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== value || url.username || url.password || !/^https?:\/\/[a-zA-Z0-9.:[\]-]+$/.test(value))
    throw new Error('RENPLAY_DEMO_EMBEDDER must be one HTTP or HTTPS origin without a trailing slash')
  return url.origin
}

/** The demo is the only installation that grants another origin access to the player. */
export function demoFrameAncestors(demo: boolean, embedder: string): string {
  return `frame-ancestors 'self'${demo ? ` ${demoEmbedderOrigin(embedder)}` : ''}`
}

export function embedMessage(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, origin: string, parent: MessageEventSource): 'nudge' | 'refresh' | null {
  if (event.origin !== origin || event.source !== parent) return null
  if (event.data?.type === 'renplay-embed:nudge') return 'nudge'
  if (event.data?.type === 'renplay-embed:refresh') return 'refresh'
  return null
}
