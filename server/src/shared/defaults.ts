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

/** The sizes a person or the admin can choose for Ren'Py text. */
export const TEXT_SIZES: readonly number[] = [1, 1.25, 1.5]

/** A list of tag ids, as the Catalog page keeps them: a few, each lowercase letters, digits and hyphens. */
export function isTagIdList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= 60 && v.every((t) => typeof t === 'string' && /^[a-z0-9-]{1,40}$/.test(t))
}
