import { viewer } from './accounts-context.js'
import { parseJson } from './db.js'
import type { Config } from './config.js'
import type { Db, GameRow } from './db.js'
import { HttpError } from './util/paths.js'

/**
 * The three adult levels, ordered so each one shows more than the previous.
 * Off: adult games do not exist. Blurred: they show with titles and metadata,
 * but the server never sends a byte of their art. Shown: everything.
 */
export type AdultLevel = 'off' | 'blurred' | 'shown'
export const ADULT_LEVELS: readonly AdultLevel[] = ['off', 'blurred', 'shown']

/** Parses off/blurred/shown; with aliases, the 3.x spellings allow (shown) and block (off). */
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
 * skipped with a warning; the safe reading of a mistake is no mapping.
 */
export function parseAdultGroups(value: string, variable: string): Record<string, AdultLevel> | null {
  const out: Record<string, AdultLevel> = {}
  for (const entry of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = entry.lastIndexOf('=')
    const level = eq > 0 ? parseAdultLevel(entry.slice(eq + 1), true) : null
    if (eq > 0 && entry.slice(0, eq).trim() && level) out[entry.slice(0, eq).trim()] = level
    else console.warn(`${variable}: skipping "${entry}", which is not group=off, =blurred or =shown`)
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

const KEY = 'adult_level'
/** The 3.x key, kept readable and in step so a downgrade to 3.2 keeps working. */
const LEGACY_KEY = 'adult_games'

/** What a 3.2 server reads: access plus the old account picture preference. */
export function legacyMirror(ceiling: AdultLevel, choice: AdultLevel): { adultAccess: 0 | 1; adultPictures: 'show' | 'hide-pictures' | 'hide-games' } {
  const effective = lowestLevel(ceiling, choice)
  return {
    adultAccess: ceiling === 'off' ? 0 : 1,
    adultPictures: effective === 'shown' ? 'show' : effective === 'blurred' ? 'hide-pictures' : 'hide-games',
  }
}

/** The 3.2 install switch: blurred has no 3.2 equivalent and reads as allow there. */
export function legacyInstallMirror(level: AdultLevel): 'allow' | 'block' {
  return level === 'off' ? 'block' : 'allow'
}

/**
 * The installation's adult level and the per-request enforcement of the
 * effective level (the lowest of installation, the person's ceiling and the
 * person's choice). RENPLAY_ADULT_GAMES fixes the installation level;
 * otherwise the stored setting holds it. Libraries that answered the 3.x
 * first-run question read as shown/off through the legacy key; a fresh
 * install has no answer yet and shows everything until the admin chooses.
 */
export class ContentMode {
  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
  ) {}

  /** The server's configuration decides; Settings cannot change it. */
  get locked(): boolean {
    return !!this.cfg.adultGames
  }

  /** False on a fresh install that has not been asked yet. */
  get chosen(): boolean {
    return this.locked || this.stored() !== null
  }

  /** The installation level: the variable, the stored setting, or the default shown. */
  get level(): AdultLevel {
    return this.cfg.adultGames || this.stored() || 'shown'
  }

  set(level: AdultLevel): void {
    if (this.locked) throw new HttpError(409, 'The server’s configuration sets this')
    this.db.setSetting(KEY, level)
    this.db.setSetting(LEGACY_KEY, legacyInstallMirror(level))
  }

  /** The person's ceiling: set by an admin, or recomputed from sign-in groups at each sign-in. */
  ceilingOf(u: { adult_ceiling?: string }): AdultLevel {
    return parseAdultLevel(u.adult_ceiling) ?? this.cfg.adultDefault
  }

  choiceOf(u: { adult_choice?: string }): AdultLevel {
    return parseAdultLevel(u.adult_choice) ?? this.cfg.adultDefault
  }

  /** The effective level for this request: the lowest layer. Background work sees the installation level. */
  viewerLevel(): AdultLevel {
    const u = viewer()?.user
    if (!u) return this.level
    return lowestLevel(this.level, this.ceilingOf(u), this.choiceOf(u))
  }

  /** A game counts as adult from its recipe's flag. Games without a recipe count as adult for a
   * person whose own layers hide adult games (like 3.x account restriction), while the
   * installation alone never hides them, so they can still be classified and marked safe. */
  private adult(game: Pick<GameRow, 'adult'> & Partial<Pick<GameRow, 'id' | 'recipe_id'>>): boolean {
    if (game.adult === 1) return true
    if (game.recipe_id !== '') return false
    const u = viewer()?.user
    if (!u) return false
    if (lowestLevel(this.ceilingOf(u), this.choiceOf(u)) === 'off') {
      return !(game.id && this.db.raw.prepare('SELECT 1 FROM safe_games WHERE game = ?').get(game.id))
    }
    return false
  }

  /** Off: the game does not exist for this person. */
  hides(game: Pick<GameRow, 'adult'> & Partial<Pick<GameRow, 'id' | 'recipe_id'>> | null | undefined): boolean {
    if (!game) return false
    return this.adult(game) && this.viewerLevel() === 'off'
  }

  /** Blurred: the game shows, but its art is never sent. */
  blurs(game: Pick<GameRow, 'adult'> & Partial<Pick<GameRow, 'id' | 'recipe_id'>> | null | undefined): boolean {
    if (!game) return false
    return this.adult(game) && this.viewerLevel() === 'blurred'
  }

  hidesRecipe(adult: boolean | undefined): boolean {
    return adult === true && this.viewerLevel() === 'off'
  }

  blursRecipe(adult: boolean | undefined): boolean {
    return adult === true && this.viewerLevel() === 'blurred'
  }

  private stored(): AdultLevel | null {
    const v = parseAdultLevel(this.db.getSetting<unknown>(KEY, null))
    if (v) return v
    // A 3.x setting: allow reads as shown, block as off, never asked stays unset.
    return parseAdultLevel(this.db.getSetting<unknown>(LEGACY_KEY, null), true)
  }
}

/** `.../index.v3.json` -> `.../index.v3.sfw.json`; null when the URL has no such sibling. */
export function sfwIndexUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/\.json$/i.test(u.pathname) || /\.sfw\.json$/i.test(u.pathname)) return null
    u.pathname = u.pathname.replace(/\.json$/i, '.sfw.json')
    return u.toString()
  } catch {
    return null
  }
}
