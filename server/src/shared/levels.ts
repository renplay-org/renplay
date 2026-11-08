/**
 * The three adult levels, ordered so each one shows more than the previous.
 * Off: adult games do not exist. Blurred: they show with titles and metadata,
 * but the server never sends a byte of their art. Shown: everything.
 */
export type AdultLevel = 'off' | 'blurred' | 'shown'
export const ADULT_LEVELS: readonly AdultLevel[] = ['off', 'blurred', 'shown']

/** Parses off/blurred/shown; with aliases, also allow (shown) and block (off), which settings accept. */
export function parseAdultLevel(value: unknown, aliases = false): AdultLevel | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (v === 'off' || v === 'blurred' || v === 'shown') return v
  if (aliases && v === 'allow') return 'shown'
  if (aliases && v === 'block') return 'off'
  return null
}

/** Levels can only narrow: the effective level is the lowest of the layers. */
export function lowestLevel(...levels: AdultLevel[]): AdultLevel {
  return ADULT_LEVELS[Math.min(...levels.map((l) => ADULT_LEVELS.indexOf(l)))]!
}
