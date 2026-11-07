import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Request, Response, RequestHandler } from 'express'
import multer from 'multer'
import { HttpError } from '../util/paths.js'

export const IMPORT_MAX_BYTES = 128 << 20
export const IMPORT_MAX_FILE_BYTES = 64 << 20
export const IMPORT_CONCURRENCY = 2
let active = 0

/** One global budget covers personal and admin imports, including disconnected handlers. */
export function saveImport(field: 'file' | 'files', handler: (req: Request, res: Response) => Promise<void>, opts: { fields?: number } = {}): RequestHandler {
  return async (req, res, next) => {
    if (active >= IMPORT_CONCURRENCY) return next(new HttpError(429, 'Another save import is running. Try again shortly.'))
    if (Number(req.get('content-length')) > IMPORT_MAX_BYTES + (1 << 20)) return next(new HttpError(413, 'Save import too large'))
    active++
    let directory = ''
    try {
      directory = await mkdtemp(join(tmpdir(), 'renplay-save-import-'))
      let total = 0, index = 0
      const storage: multer.StorageEngine = {
        _handleFile(_req, file, done) {
          const path = join(directory, String(index++))
          const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            total += chunk.length
            callback(total > IMPORT_MAX_BYTES ? new HttpError(413, 'Save import too large') : null, chunk)
          } })
          pipeline(file.stream, counter, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
            .then(() => done(null, { path }), done)
        },
        _removeFile(_req, file, done) { rm(file.path, { force: true }).then(() => done(null), done) },
      }
      const upload = multer({ storage, limits: { fileSize: IMPORT_MAX_FILE_BYTES, files: field === 'file' ? 1 : 200, fields: opts.fields ?? 0, parts: 201 + (opts.fields ?? 0), fieldNameSize: 100, headerPairs: 100 } })
      await new Promise<void>((resolve, reject) => (field === 'file' ? upload.single(field) : upload.array(field))(req, res, (error) => error ? reject(error) : resolve()))
      await handler(req, res)
    } catch (error) { next(error) }
    finally {
      try { if (directory) await rm(directory, { recursive: true, force: true }) }
      finally { active-- }
    }
  }
}
