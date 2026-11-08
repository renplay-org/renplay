import type { Db } from '../db.js'

/**
 * Defaults for everyone: what a person starts with until they choose. Each value is null when the
 * admin leaves it to Renplay's own default.
 */
export interface Defaults {
  /** Tags left out on the Catalog page. */
  tagsExclude: string[]
  /** Lighter background on browsers that did not choose. */
  lighterBackground: boolean | null
  /** Ren'Py text size in games where the person did not choose one. */
  textSize: number | null
  rollback: boolean | null
  skip: boolean | null
}
export const DEFAULTS_KEY = 'defaults_for_everyone'
export function readDefaults(db: Db): Defaults {
  const d = db.getSetting<Partial<Defaults>>(DEFAULTS_KEY, {})
  return {
    tagsExclude: Array.isArray(d.tagsExclude) ? d.tagsExclude.filter((t) => typeof t === 'string') : [],
    lighterBackground: typeof d.lighterBackground === 'boolean' ? d.lighterBackground : null,
    textSize: typeof d.textSize === 'number' && [1, 1.25, 1.5].includes(d.textSize) ? d.textSize : null,
    rollback: typeof d.rollback === 'boolean' ? d.rollback : null,
    skip: typeof d.skip === 'boolean' ? d.skip : null,
  }
}
