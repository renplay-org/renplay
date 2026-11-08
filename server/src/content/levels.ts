import { ADULT_LEVELS, parseAdultLevel, type AdultLevel } from '../shared/levels.js'

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
