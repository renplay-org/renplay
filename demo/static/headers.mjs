// The static demo's headers (the _headers file of Cloudflare's static assets), written next to the files.

/** One exact web origin, the way the server's RENPLAY_DEMO_EMBEDDER is checked (shared/demo-embed.ts). */
function checkEmbedder(value) {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== value || url.username || url.password || !/^https?:\/\/[a-zA-Z0-9.:[\]-]+$/.test(value))
    throw new Error('The embedder must be one HTTP or HTTPS origin without a trailing slash')
  return value
}

/**
 * - Frames: the demo is framed by itself and by the website's origin only, the policy the server demo sends
 *   (shared/demo-embed.ts).
 * - Search engines: every answer says noindex (the demo is for trying, not for results), and robots.txt lets crawlers in
 *   to read it (seo.mjs).
 * - Caching: index.html and the worker are checked each time, files named by their content are kept for good.
 */
export function headersFor(embedder) {
  const rules = {
    '/*': { 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', 'Content-Security-Policy': `frame-ancestors 'self' ${checkEmbedder(embedder)}` },
    '/index.html': { 'Cache-Control': 'no-cache' },
    '/sw.js': { 'Cache-Control': 'no-cache' },
    '/demo/*': { 'Cache-Control': 'no-cache' },
    '/assets/*': { 'Cache-Control': 'public, max-age=31536000, immutable' },
    '/api/art/*': { 'Cache-Control': 'public, max-age=31536000, immutable' },
  }
  return Object.entries(rules).map(([path, headers]) => `${path}\n${Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`).join('\n')}\n`).join('')
}
