import type { Db } from '../db.js'
import { TEXT_SIZES, type Defaults } from '../shared/defaults.js'


export const DEFAULTS_KEY = 'defaults_for_everyone'
export function readDefaults(db: Db): Defaults {
  const d = db.getSetting<Partial<Defaults>>(DEFAULTS_KEY, {})
  return {
    tagsExclude: Array.isArray(d.tagsExclude) ? d.tagsExclude.filter((t) => typeof t === 'string') : [],
    lighterBackground: typeof d.lighterBackground === 'boolean' ? d.lighterBackground : null,
    textSize: typeof d.textSize === 'number' && TEXT_SIZES.some((t) => t.value === d.textSize) ? d.textSize : null,
    rollback: typeof d.rollback === 'boolean' ? d.rollback : null,
    skip: typeof d.skip === 'boolean' ? d.skip : null,
  }
}
