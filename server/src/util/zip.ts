import yauzl from 'yauzl'
import { HttpError, cleanRelPath } from './paths.js'

/** How much a zip may hold: files, the size of each, and all of them together. */
export interface ZipLimits {
  files: number
  fileBytes: number
  totalBytes: number
}

/** True when `data` starts like a zip. */
export function isZip(data: Buffer): boolean {
  return data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
}

/**
 * Reads a zip's files into memory, after checking its whole directory: no links or special files, no
 * paths that leave it, no duplicates, and the limits given. `times` gets each file's time.
 */
export function readZipEntries(data: Buffer | string, want: (name: string) => boolean, limits: ZipLimits, times?: Map<string, number>): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const opened = (err: Error | null, zip?: yauzl.ZipFile) => {
      if (err || !zip) return reject(new HttpError(400, err?.message ?? 'Invalid zip'))
      let failed = false, total = 0, count = 0
      const entries: yauzl.Entry[] = [], names = new Set<string>()
      const fail = (error: Error) => {
        if (failed) return
        failed = true
        zip.close()
        reject(error instanceof HttpError ? error : new HttpError(400, error.message))
      }
      zip.on('error', fail)
      if (zip.entryCount > limits.files) return fail(new HttpError(413, 'Too many zip entries'))
      // Validate the entire directory before opening even the first content stream.
      zip.on('entry', (e: yauzl.Entry) => {
        try {
          if (++count > limits.files) throw new HttpError(413, 'Too many zip entries')
          const path = cleanRelPath(e.fileName)
          const type = (e.externalFileAttributes >>> 16) & 0xf000
          if (type && type !== 0x8000 && type !== 0x4000) throw new HttpError(400, 'Zip links and special files are not allowed')
          if (names.has(path)) throw new HttpError(400, 'Duplicate zip path')
          names.add(path)
          total += e.uncompressedSize
          if (e.uncompressedSize > limits.fileBytes || total > limits.totalBytes) throw new HttpError(413, 'Zip contents too large')
          if (!e.fileName.endsWith('/') && want(e.fileName)) entries.push(e)
          zip.readEntry()
        } catch (error) { fail(error as Error) }
      })
      zip.on('end', () => {
        const out = new Map<string, Buffer>()
        const next = (i: number) => {
          if (failed) return
          if (i === entries.length) { zip.close(); resolve(out); return }
          const entry = entries[i]!
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream) return fail(error ?? new Error('Invalid zip stream'))
            const chunks: Buffer[] = []
            let bytes = 0
            stream.on('data', (chunk: Buffer) => {
              bytes += chunk.length
              if (bytes > entry.uncompressedSize || bytes > limits.fileBytes) { stream.destroy(); fail(new HttpError(413, 'Zip entry too large')) }
              else chunks.push(chunk)
            })
            stream.on('error', fail)
            stream.on('end', () => {
              out.set(entry.fileName, Buffer.concat(chunks))
              times?.set(entry.fileName, entry.getLastModDate().getTime())
              next(i + 1)
            })
          })
        }
        next(0)
      })
      zip.readEntry()
    }
    const options = { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, autoClose: false, strictFileNames: true }
    if (typeof data === 'string') yauzl.open(data, options, opened)
    else yauzl.fromBuffer(data, options, opened)
  })
}
