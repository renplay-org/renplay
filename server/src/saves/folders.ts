/** A save folder's name as it is compared: Windows, macOS and some shares treat names that differ in capitals or Unicode form as one folder. */
export const folderKey = (name: string): string => name.normalize('NFC').toLowerCase()

/** The save folders games in the library use. Asked again under the folder's lock, because a game can be added meanwhile. */
export type LibraryDirs = () => ReadonlySet<string>
export const IN_LIBRARY = 'This game is still in your library. Remove it from the library first, then delete its saves.'
export const NO_SAVES = 'No saves of this game were found'
