import type { CookieOptions } from 'express'

/** How long a session lasts. */
export const DAYS30 = 30 * 86400_000
/** The session cookie, and its partitioned form for the demo's frames. The proxy's cache key names both (image/nginx.conf.template). */
const SESSION_COOKIE = 'renplay_session'
const FRAMED_COOKIE = 'renplay_session_framed'

/**
 * The cookie to set, or with an empty value to clear. A frame of another site keeps its own copy (CHIPS), where
 * it is allowed only so. It has a name of its own: with one name a browser sends both forms, and the older one,
 * a direct visit's, would be read first.
 */
export function sessionCookie(value: string, secure: boolean, partitioned: boolean): [string, string, CookieOptions] {
  const maxAge = value ? DAYS30 : 0
  return partitioned
    ? [FRAMED_COOKIE, value, { httpOnly: true, sameSite: 'none', secure: true, partitioned: true, path: '/', maxAge }]
    : [SESSION_COOKIE, value, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge }]
}

/** The session tokens a request carries. The framed one is the one a key signed in last, so it comes first, and the plain one is the way back when it is gone. */
export function sessionTokens(header: string | undefined): string[] {
  return [FRAMED_COOKIE, SESSION_COOKIE].flatMap((name) => header?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? [])
}
