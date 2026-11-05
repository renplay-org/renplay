/** Canonicalize with the browser's URL parser before deciding whether navigation is local. */
export function signInReturnUrl(target: string | null, origin: string): string {
  try {
    const url = new URL(target || '/', origin)
    if (url.origin === origin) return url.href
  } catch {}
  return new URL('/', origin).href
}
