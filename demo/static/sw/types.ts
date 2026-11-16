import type { Game, Me } from '../../../server/src/shared/api'

/** What the build captured from a running demo, as the real API answered it. */
export interface Snapshot {
  routes: Record<string, unknown>
  me: Me
  games: Game[]
}

export interface FileRow { key: string; dir: string; name: string; data: ArrayBuffer; mtime: number }
export interface VersionRow { id: string; key: string; dir: string; name: string; data: ArrayBuffer; savedAt: number; reason: string }
export interface NoteRow { key: string; title: string; note: string; pinnedAt: string }
export interface Progress { id: string; favoriteAt?: string | null; playStatus?: string | null; finishedAt?: string | null; rating?: number | null; notNowAt?: string | null; playTime?: number; lastPlayedAt?: string | null }

export interface Tables {
  files: FileRow
  versions: VersionRow
  notes: NoteRow
  progress: Progress
}
export type Table = keyof Tables

/** Where the visitor's saves and progress live: IndexedDB in the browser (idb.ts), memory in the contract test. */
export interface Store {
  all<T extends Table>(table: T): Promise<Array<Tables[T]>>
  get<T extends Table>(table: T, key: string): Promise<Tables[T] | undefined>
  put<T extends Table>(table: T, row: Tables[T]): Promise<void>
  del(table: Table, key: string): Promise<void>
}

/** What the stand-in needs from the place it runs in. */
export interface Env {
  store: Store
  snapshot: () => Promise<Snapshot>
  /** Saves or progress changed: every open page of the demo refetches. */
  notify: () => void
}
