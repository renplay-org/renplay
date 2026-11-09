import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rename, stat, lstat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** Writes a file atomically: temp file in the same directory, fsync, rename. */
export async function writeFileAtomic(path: string, data: Uint8Array | string, mtime?: Date): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
    if (mtime) await fh.utimes(mtime, mtime)
  } finally {
    await fh.close()
  }
  try {
    await rename(tmp, path)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
}

/** Whether a file is there: false only when it is missing, null when it could not be told (a share that stalls). */
export async function presence(path: string): Promise<boolean | null> {
  try {
    await lstat(path)
    return true
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR' ? false : null
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

export interface WalkEntry {
  rel: string
  full: string
  size: number
  mtimeMs: number
}

/** Recursively lists regular files under `root` (no symlink following). */
export async function walkFiles(root: string, opts: { skipHidden?: boolean } = {}): Promise<WalkEntry[]> {
  const out: WalkEntry[] = []
  async function walk(dir: string, prefix: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (opts.skipHidden && e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) await walk(full, rel)
      else if (e.isFile()) {
        // A file can go between the listing and here: a save written through a temporary file.
        const st = await stat(full).catch(() => null)
        if (!st) continue
        out.push({ rel, full, size: st.size, mtimeMs: st.mtimeMs })
      }
    }
  }
  await walk(root, '')
  return out
}

export async function dirSize(root: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  async function walk(dir: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries.map(async (e) => {
        const full = join(dir, e.name)
        if (e.isDirectory()) await walk(full)
        else if (e.isFile()) {
          try {
            // Read the size first: `bytes += await ...` would read `bytes` before awaiting.
            const size = (await stat(full)).size
            bytes += size
            files++
          } catch {}
        }
      }),
    )
  }
  await walk(root)
  return { bytes, files }
}

export function sha256File(path: string, onProgress?: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    let n = 0
    const s = createReadStream(path, { highWaterMark: 4 << 20 })
    s.on('data', (c) => {
      h.update(c)
      n += c.length
      onProgress?.(n)
    })
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

export function sha1(data: Uint8Array | string): string {
  return createHash('sha1').update(data).digest('hex')
}

export function newId(prefix = ''): string {
  return prefix + Date.now().toString(36) + randomBytes(5).toString('hex')
}
