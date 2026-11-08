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
