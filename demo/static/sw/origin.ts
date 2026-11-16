/** What the stand-in looks at in a request: the part of a Request that tells where it came from. */
export interface Asked {
  method: string
  mode: string
  referrer: string
  headers: Headers
}

/**
 * Whether a request that changes something comes from a page that is not the demo's own. The server's csrf()
 * (accounts/accounts.ts) reads Origin and Fetch Metadata. A worker is handed what the browser keeps for it, which
 * may not include those, so the rules below also read where the request was sent from and what kind it is: the
 * demo's pages change things with fetch only, so a navigation that changes something is a form of another site.
 */
export function fromElsewhere(req: Asked, origin: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return true
  const from = req.headers.get('origin')
  if (from && from !== origin) return true
  if (req.mode === 'navigate') return true
  if (req.referrer && req.referrer !== 'about:client' && new URL(req.referrer, origin).origin !== origin) return true
  return false
}
