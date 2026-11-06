import type { Stats } from 'node:fs'
import { copyFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/** A replaced or edited download is no longer an upload we own, even at the same path. */
export function archiveIdentity(st: Stats): string {
  return JSON.stringify([st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs])
}

/** Publish a completed upload atomically even when downloads use a separate filesystem. */
export async function publishUpload(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination)
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  }
  const temporary = join(dirname(destination), `.upload-${randomUUID()}`)
  try {
    await copyFile(source, temporary)
    await rename(temporary, destination)
    await unlink(source)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
