import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync, readlinkSync, statSync, utimesSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/** Copy first, verify every file, then remove. A restart can resume at any folder boundary. */
function mergeTree(source: string, target: string, conflicts: string): void {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name), to = join(target, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Save migration refuses a symlink: ${from}`)
    if (entry.isDirectory()) mergeTree(from, to, join(conflicts, entry.name))
    else if (entry.isFile()) {
      const data = readFileSync(from)
      let dest = to
      if (existsSync(to) && !readFileSync(to).equals(data)) {
        // A partially migrated target wins; the original remains recoverable, never overwritten.
        dest = join(conflicts, entry.name, createHash('sha256').update(data).digest('hex'))
      }
      mkdirSync(dirname(dest), { recursive: true })
      if (!existsSync(dest)) copyFileSync(from, dest)
      if (!readFileSync(dest).equals(data)) throw new Error(`Save migration verification failed: ${from}`)
      const times = statSync(from)
      utimesSync(dest, times.atime, times.mtime)
    }
  }
}

export function migrateAccountFolders(raw: DatabaseSync, dataDir: string, saves: string, history: string): void {
  const owner = join(dataDir, 'users', '1')
  const backup = join(dataDir, 'backups', 'pre-3.0')
  mkdirSync(backup, { recursive: true })
  // This stable checkpoint is never replaced on restart, including a crash during the folder move.
  if (!existsSync(join(backup, 'library.db'))) {
    raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    copyFileSync(join(dataDir, 'library.db'), join(backup, 'library.db.tmp'))
    renameSync(join(backup, 'library.db.tmp'), join(backup, 'library.db'))
  }
  const folders = [[saves, 'saves'], [history, 'save-history']] as const
  // Finish *both* backups before touching either original folder.
  for (const [old, name] of folders) {
    if (existsSync(join(backup, `${name}.ready`))) continue
    if (existsSync(old) && !lstatSync(old).isSymbolicLink()) cpSync(old, join(backup, name), { recursive: true, preserveTimestamps: true })
    writeFileSync(join(backup, `${name}.ready`), '')
  }
  for (const [old, name] of folders) {
    const target = resolve(owner, name)
    const src = resolve(old)
    if (src === target) { mkdirSync(target, { recursive: true }); continue }
    if (existsSync(src) && lstatSync(src).isSymbolicLink()) {
      // A completed folder from an interrupted migration.
      if (resolve(dirname(src), readlinkSync(src)) !== target) throw new Error(`Unexpected save symlink: ${src}`)
      continue
    }
    mkdirSync(dirname(target), { recursive: true })
    mkdirSync(dirname(src), { recursive: true })
    const probe = `${src}.renplay-symlink-check-${randomUUID()}`
    try { symlinkSync(target, probe, 'dir') } finally { rmSync(probe, { force: true }) }
    if (existsSync(src) && !existsSync(target)) {
      try { renameSync(src, target) } catch (e: any) { if (e.code !== 'EXDEV') throw e }
    }
    if (existsSync(src)) {
      mergeTree(src, target, join(owner, 'migration-conflicts', name))
      rmSync(src, { recursive: true })
    }
    mkdirSync(target, { recursive: true })
    mkdirSync(dirname(src), { recursive: true })
    symlinkSync(target, src, 'dir')
  }
  writeFileSync(join(owner, 'user.json'), JSON.stringify({ id: 1, name: 'Owner', created: new Date().toISOString() }) + '\n')
}
