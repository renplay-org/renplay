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

/**
 * A sign-in group mapping, as in RENPLAY_OIDC_ADULT_GROUPS and
 * RENPLAY_LDAP_ADULT_GROUPS: "group=level,group=level". Bad entries are
 * skipped with a warning, so their groups match nothing. Null when no entry
 * is valid (config.ts still treats the variable as set, everyone at off).
 */
export function parseAdultGroups(value: string, variable: string): Record<string, AdultLevel> | null {
  const out: Record<string, AdultLevel> = {}
  for (const entry of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.lastIndexOf('=')
    const level = eq > 0 ? parseAdultLevel(entry.slice(eq + 1), true) : null
    if (eq > 0 && entry.slice(0, eq).trim() && level) out[entry.slice(0, eq).trim()] = level
    else console.warn(`config: ${variable}: skipping "${entry}", which is not group=off, =blurred or =shown`)
  }
  return Object.keys(out).length ? out : null
}

/** The highest level of the person's matching groups, or off when none match. */
export function groupCeiling(map: Record<string, AdultLevel>, groups: Iterable<string>): AdultLevel {
  let level: AdultLevel = 'off'
  for (const g of groups) {
    const l = map[g]
    if (l && ADULT_LEVELS.indexOf(l) > ADULT_LEVELS.indexOf(level)) level = l
  }
  return level
}
