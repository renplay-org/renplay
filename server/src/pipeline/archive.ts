import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import yauzl from 'yauzl'
import { walkFiles } from '../util/fsx.js'
import { cleanRelPath } from '../util/paths.js'

export interface SourceEntry {
  /** POSIX path inside the archive. */
  path: string
  size: number
  /** True when byte ranges can be read without decompressing from the start. */
  seekable: boolean
  open(range?: { start: number; end: number }): Promise<Readable>
}

export interface ArchiveSource {
  kind: 'zip' | 'dir'
  entries: SourceEntry[]
  close(): void
}

export type ArchiveType = 'zip' | '7z' | 'rar' | 'tar' | 'unknown'

export async function sniffArchive(path: string): Promise<ArchiveType> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(512)
    const { bytesRead } = await fh.read(buf, 0, 512, 0)
    const b = buf.subarray(0, bytesRead)
    if (b[0] === 0x50 && b[1] === 0x4b) return 'zip'
    if (b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return '7z'
    if (b.subarray(0, 4).toString('latin1') === 'Rar!') return 'rar'
    if (bytesRead >= 262 && b.subarray(257, 262).toString('latin1') === 'ustar') return 'tar'
    if (b[0] === 0x1f && b[1] === 0x8b) return 'tar'
    if (b.subarray(0, 3).toString('latin1') === 'BZh') return 'tar'
    if (b[0] === 0xfd && b.subarray(1, 6).toString('latin1') === '7zXZ') return 'tar'
    if (b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd) return 'tar'
    return 'unknown'
  } finally {
    await fh.close()
  }
}

export function openZip(path: string): Promise<ArchiveSource> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Cannot open zip'))
      const entries: SourceEntry[] = []
      zip.on('entry', (e: yauzl.Entry) => {
        if (!e.fileName.endsWith('/')) {
          let p: string | null = null
          try {
            p = cleanRelPath(e.fileName)
          } catch {
            p = null
          }
          if (p) {
            const stored = e.compressionMethod === 0 && !e.isEncrypted()
            entries.push({
              path: p,
              size: e.uncompressedSize,
              seekable: stored,
              open: (range) =>
                new Promise((res, rej) => {
                  const opts: yauzl.ZipFileOptions = range && stored ? { start: range.start, end: range.end } : {}
                  zip.openReadStream(e, opts, (er, s) => (er || !s ? rej(er ?? new Error('stream')) : res(s)))
                }),
            })
          }
        }
        zip.readEntry()
      })
      zip.on('end', () => resolve({ kind: 'zip', entries, close: () => zip.close() }))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

export async function openDir(root: string): Promise<ArchiveSource> {
  const files = await walkFiles(root)
  return {
    kind: 'dir',
    entries: files.map((f) => ({
      path: f.rel,
      size: f.size,
      seekable: true,
      open: async (range) =>
        createReadStream(f.full, range ? { start: range.start, end: range.end - 1 } : {}),
    })),
    close: () => {},
  }
}

/**
 * Extracts 7z/rar/tar archives with bsdtar (libarchive). Zip files go through
 * the streaming reader instead, which needs no scratch space.
 */
export async function extractWithBsdtar(
  archive: string,
  dest: string,
  signal: AbortSignal,
  onLine?: (line: string) => void,
): Promise<void> {
  await mkdir(dest, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const p = spawn('bsdtar', ['-x', '-f', archive, '-C', dest, '--no-same-owner', '--no-same-permissions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal,
    })
    const relay = (d: Buffer) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => onLine?.(l))
    p.stdout.on('data', relay)
    p.stderr.on('data', relay)
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`bsdtar exited with ${code}`))))
  })
}

export async function readAll(s: Readable, limit = 512 << 20): Promise<Buffer> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of s) {
    n += c.length
    if (n > limit) {
      s.destroy()
      throw new Error('Entry too large to buffer')
    }
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks)
}
