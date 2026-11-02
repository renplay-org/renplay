import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gzip as gzipCb, constants } from 'node:zlib'
import { exists } from '../util/fsx.js'

const gzip = promisify(gzipCb)

/** Files shared by every game built with the same Ren'Py web runtime. */
export const ENGINE_FILES = ['renpy.wasm', 'renpy.data', 'renpy.js', 'renpy-pre.js'] as const
const COMPRESS = new Set(['renpy.wasm', 'renpy.data', 'renpy.js', 'renpy-pre.js'])

export async function engineIdOf(buildDir: string): Promise<string | null> {
  const wasm = join(buildDir, 'renpy.wasm')
  if (!(await exists(wasm))) return null
  const h = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(wasm, { highWaterMark: 4 << 20 })
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve())
  })
  // The pre-js differs between Ren'Py releases even when the wasm does not.
  try {
    h.update(await readFile(join(buildDir, 'renpy-pre.js')))
  } catch {}
  return h.digest('hex').slice(0, 16)
}

export async function engineReady(enginesDir: string, id: string): Promise<boolean> {
  return exists(join(enginesDir, id, '.ready'))
}

/**
 * Copies the engine files of a web build into the shared engine store, with
 * gzip variants for nginx's gzip_static. Returns the engine id.
 */
export async function registerEngine(enginesDir: string, buildDir: string): Promise<string | null> {
  const id = await engineIdOf(buildDir)
  if (!id) return null
  const dest = join(enginesDir, id)
  if (await engineReady(enginesDir, id)) return id
  for (const f of ENGINE_FILES) if (!(await exists(join(buildDir, f)))) return null
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`
  await mkdir(tmp, { recursive: true })
  for (const f of ENGINE_FILES) {
    await copyFile(join(buildDir, f), join(tmp, f))
    if (COMPRESS.has(f)) {
      const data = await readFile(join(tmp, f))
      await writeFile(join(tmp, `${f}.gz`), await gzip(data, { level: constants.Z_BEST_COMPRESSION }))
    }
  }
  await writeFile(join(tmp, '.ready'), new Date().toISOString())
  await rm(dest, { recursive: true, force: true })
  await rename(tmp, dest)
  return id
}

/** Removes engine files from a managed build once they live in the shared store. */
export async function stripEngine(buildDir: string): Promise<void> {
  for (const f of [...ENGINE_FILES, 'index.html.symbols']) await rm(join(buildDir, f), { force: true })
}
