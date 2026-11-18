import { lstat, readdir, rmdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/** A save folder's name as it is compared: Windows, macOS and some shares treat names that differ in capitals or Unicode form as one folder. */
export const folderKey = (name: string): string => name.normalize('NFC').toLowerCase()

/** The save folders games in the library use. Asked again right before every file of a deletion, because a game can be added meanwhile. */
export type LibraryDirs = () => ReadonlySet<string>
export const IN_LIBRARY = 'This game is still in your library. Remove it from the library first, then delete its saves.'
export const NO_SAVES = 'No saves of this game were found'
/** What stops a deletion that a game's claim of the folder interrupted. */
export const CLAIMED = new Error('A game in the library uses the folder')

const missing = (e: unknown): boolean => (e as NodeJS.ErrnoException).code === 'ENOENT'

/** Whether `a` and `b` are one folder in `root`: the same name but for capitals, or the same place on disk (a link, another spelling). */
export async function sameFolder(root: string, a: string, b: string): Promise<boolean> {
  if (folderKey(a) === folderKey(b)) return true
  const [x, y] = await Promise.all([a, b].map((name) => stat(join(root, name)).catch(() => null)))
  return !!x && !!y && x.dev === y.dev && x.ino === y.ino
}

/** The time an admin deleted a folder's saves, kept in the folder's History so that no database restore can move it. */
export const DELETED_MARKER = '.deleted'

export function parseDeletedAt(text: string): number | null {
  return /^\d{10,16}$/.test(text.trim()) ? Number(text.trim()) : null
}

/**
 * Deletes a file or a folder with everything in it, never following a link: a link is removed as
 * the link it is. A path that is already gone is done, any other failure is added to `failed` and
 * the rest is still tried. `before` runs right before each deletion, and what it throws stops it all.
 */
export async function removeTree(path: string, tally: { files: number; bytes: number }, failed: string[], before: () => void): Promise<void> {
  const fail = (e: unknown) => {
    if (!missing(e)) failed.push(`${path}: ${(e as Error).message}`)
  }
  let st
  try {
    st = await lstat(path)
  } catch (e) {
    return fail(e)
  }
  if (!st.isDirectory()) {
    before()
    try {
      await unlink(path)
      tally.files++
      tally.bytes += st.size
    } catch (e) {
      fail(e)
    }
    return
  }
  let names: string[]
  try {
    names = await readdir(path)
  } catch (e) {
    return fail(e)
  }
  for (const name of names) await removeTree(join(path, name), tally, failed, before)
  before()
  await rmdir(path).catch(fail)
}
