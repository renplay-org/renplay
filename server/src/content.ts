import type { Config } from './config.js'
import type { Db, GameRow } from './db.js'
import { HttpError } from './util/paths.js'

export type AdultGames = 'allow' | 'block'

const KEY = 'adult_games'

export const ADULT_REASON = 'This is an adult game, and this Renplay shows safe-for-work games only.'

/**
 * Whether this Renplay shows adult games. RENPLAY_ADULT_GAMES locks the choice;
 * otherwise a database setting holds it. Libraries that existed before the
 * switch were given "allow" by the database migration; a fresh install has no
 * choice yet and blocks until the admin answers (docs.renplay.org/developers/architecture).
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

  get adultGames(): AdultGames {
    return this.cfg.adultGames || this.stored() || 'block'
  }

  get blocked(): boolean {
    return this.adultGames === 'block'
  }

  set(mode: AdultGames): void {
    if (this.locked) throw new HttpError(409, 'The server’s configuration sets this')
    this.db.setSetting(KEY, mode)
  }

  /** Adult games stay in the library but are not shown or played while blocked. */
  hides(game: Pick<GameRow, 'adult'> | null | undefined): boolean {
    return !!game && game.adult === 1 && this.blocked
  }

  private stored(): AdultGames | null {
    const v = this.db.getSetting<unknown>(KEY, null)
    return v === 'allow' || v === 'block' ? v : null
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
