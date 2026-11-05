import type { Stats } from 'node:fs'

/** A replaced or edited download is no longer an upload we own, even at the same path. */
export function archiveIdentity(st: Stats): string {
  return JSON.stringify([st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs])
}
