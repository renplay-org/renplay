// What a search engine meets at the static demo. The demo is a copy of the app for trying it, so it stays out of the
// results: every answer says noindex, and crawlers are let in on purpose, because a crawler that is blocked by
// robots.txt never reads the noindex and the address can still be listed (Google's block-indexing page).

export const DEMO_TITLE = 'Renplay demo'
export const DEMO_DESCRIPTION = 'Try Renplay, the self-hosted Ren’Py player, in your browser. Play a free sample game, with saves kept in this browser.'

/** Crawlers may fetch everything, and read the noindex. */
export const ROBOTS_TXT = 'User-agent: *\nAllow: /\n'

/** The library's index.html with the demo's own title and description, and the noindex of its meta. */
export function demoHead(html) {
  if (!html.includes('<title>Renplay</title>')) throw new Error('The built index.html has no plain title to replace')
  return html.replace('<title>Renplay</title>', `<title>${DEMO_TITLE}</title>
    <meta name="description" content="${DEMO_DESCRIPTION}" />
    <meta name="robots" content="noindex" />`)
}
