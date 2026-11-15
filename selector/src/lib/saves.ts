import type { SaveSlot } from '@shared/api'
import { ago } from './format'

/** What a save is called: this person's name for it, the game's, or the slot. */
export const saveName = (s: SaveSlot): string => s.title || s.name || s.label

/** The muted line under a save's name: its slot and when, "Quick 1 · 8 minutes ago". */
export const saveLine = (s: SaveSlot): string => (saveName(s) === s.label ? ago(s.ctime) : `${s.label} · ${ago(s.ctime)}`)

/** Why a version went to History, in plain words. */
export const versionReason = (reason: string): string =>
  ({
    game: 'Saved over in the game',
    overwrite: 'Saved over',
    conflict: 'The older of two copies',
    delete: 'Deleted',
    'game-delete': 'Deleted in the game',
    'user-delete': 'Deleted here',
    import: 'Replaced by an import',
    'user-import': 'Replaced by an import',
    restore: 'Replaced by a restore',
    sync: 'Replaced by a Sync code',
    copy: 'Replaced by a copy',
    'user-copy': 'Replaced by a copy',
    'merge-keys': 'Replaced when two devices were joined',
  })[reason] ?? 'An earlier version'

/** Pinned saves first (only when there are any), then the rest, newest first, every kind together. */
export function groupSaves(slots: SaveSlot[]): { pinned: SaveSlot[]; recent: SaveSlot[] } {
  const newest = [...slots].sort((a, b) => b.ctime - a.ctime)
  return { pinned: newest.filter((s) => s.pinnedAt), recent: newest.filter((s) => !s.pinnedAt) }
}
