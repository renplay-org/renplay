import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/** VACUUM INTO includes committed WAL data without stopping the running server. */
export function copyDatabase(raw: DatabaseSync, dir: string, prefix = 'library'): string {
  mkdirSync(dir, { recursive: true })
  const name = `${prefix}-${new Date().toISOString().replaceAll(':', '')}-${randomUUID()}.db`
  const path = join(dir, name)
  const temp = join(dir, `.${name}.part`)
  try {
    raw.prepare('VACUUM INTO ?').run(temp)
    renameSync(temp, path)
    return path
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}
