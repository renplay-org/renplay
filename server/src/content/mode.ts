import { viewer } from '../accounts-context.js'
import type { Config } from '../config.js'
import type { Db, GameRow } from '../db.js'
import { HttpError, assertSlug } from '../util/paths.js'
import { lowestLevel, parseAdultLevel, type AdultLevel } from './levels.js'

const KEY = 'adult_level'

/**
 * The installation's adult level and the per-request enforcement of the
 * effective level (the lowest of installation, the person's ceiling and the
 * person's choice). RENPLAY_ADULT_GAMES fixes the installation level;
 * otherwise the stored setting holds it. A fresh install has no answer yet and
 * shows everything until the admin chooses.
 */
export class ContentMode {
  /** `adultSaveDirs` lists the save folders adult recipes name: the catalog knows them (services.ts). */
  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
    private readonly adultSaveDirs: () => Iterable<string> = () => [],
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
  }

  /** The person's ceiling: set by an admin, or recomputed from sign-in groups at each sign-in. */
  ceilingOf(u: { adult_ceiling?: string }): AdultLevel {
    return parseAdultLevel(u.adult_ceiling) ?? this.cfg.adultDefault
  }

  choiceOf(u: { adult_choice?: string }): AdultLevel {
    return parseAdultLevel(u.adult_choice) ?? this.cfg.adultDefault
  }

  /** The effective level for this request: the lowest layer, this device's included. Background work sees the installation level. */
  viewerLevel(): AdultLevel {
    const v = viewer()
    if (!v) return this.level
    return lowestLevel(this.level, this.ceilingOf(v.user), this.choiceOf(v.user), v.device ?? 'shown')
  }

  /** A game counts as adult from its recipe's flag. Games without a recipe count as adult for a
   * person whose own layers hide adult games, while the
   * installation alone never hides them, so they can still be classified and marked safe. */
  private adult(game: Pick<GameRow, 'adult'> & Partial<Pick<GameRow, 'id' | 'recipe_id'>>): boolean {
    if (game.adult === 1) return true
    if (game.recipe_id !== '') return false
    const v = viewer()
    if (!v) return false
    if (lowestLevel(this.ceilingOf(v.user), this.choiceOf(v.user), v.device ?? 'shown') === 'off') {
      return !(game.id && this.db.raw.prepare('SELECT 1 FROM safe_games WHERE game = ?').get(game.id))
    }
    return false
  }

  /**
   * The save folders this person may see, out of `dirs`. Off leaves out every folder of an adult
   * game: an installed one's, one an adult recipe names, and, when games without a recipe count as
   * adult for this person, any folder no game in the library claims. Nothing is moved or deleted.
   */
  visibleSaveDirs(dirs: Iterable<string>): string[] {
    if (this.viewerLevel() !== 'off') return [...dirs]
    const games = this.db.allGames()
    const hidden = new Set(this.adultSaveDirs())
    for (const g of games) if (g.save_dir && this.hides(g)) hidden.add(g.save_dir)
    for (const g of games) if (g.save_dir && !this.hides(g)) hidden.delete(g.save_dir)
    const restricted = this.hides({ adult: 0, recipe_id: '' })
    const claimed = new Set(games.map((g) => g.save_dir).filter(Boolean))
    return [...dirs].filter((d) => !hidden.has(d) && (!restricted || claimed.has(d)))
  }

  /** A library game as this person may see it, by its id from a request. */
  game(id: unknown): GameRow {
    const g = this.db.getGame(assertSlug(id))
    if (!g || this.hides(g)) throw new HttpError(404, 'Game not found')
    return g
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
    return parseAdultLevel(this.db.getSetting<unknown>(KEY, null))
  }
}
