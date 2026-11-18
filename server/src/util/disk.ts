import { statfs } from 'node:fs/promises'

export interface DiskSpace {
  total: number
  free: number
}

/** The size and the free space of the disk a path is on, or null when the path cannot be read. */
export async function diskSpace(path: string): Promise<DiskSpace | null> {
  try {
    const s = await statfs(path)
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }
  } catch {
    return null
  }
}
