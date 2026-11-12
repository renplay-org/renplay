#!/usr/bin/env node
// Keep container sources current, including deletions, without touching dependencies or build output.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, chmodSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const [source, target] = process.argv.slice(2).map((p) => resolve(p))
if (!source || !target || source === target) throw new Error('Usage: ui-workspace.mjs <source> <target>')
const stateFile = join(target, '.ui-workspace.json')
const previous = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')).files : {}
const files = {}
const excluded = new Set(['node_modules', 'dist', 'dist-adult', '.git', 'ui-test-results', '.astro'])
function sync(dir = '') {
  for (const name of readdirSync(join(source, dir)).sort()) {
    if (excluded.has(name) || name.endsWith('.tsbuildinfo')) continue
    const path = join(dir, name)
    const from = join(source, path)
    const to = join(target, path)
    const stat = lstatSync(from)
    if (stat.isDirectory()) { sync(path); continue }
    const link = stat.isSymbolicLink() ? readlinkSync(from) : null
    const hash = createHash('sha256').update(link ?? readFileSync(from)).update(String(stat.mode)).digest('hex')
    files[path] = hash
    if (previous[path] === hash && existsSync(to)) continue
    mkdirSync(dirname(to), { recursive: true })
    rmSync(to, { recursive: true, force: true })
    if (link !== null) symlinkSync(link, to)
    else { copyFileSync(from, to); chmodSync(to, stat.mode) }
  }
}
// Remove old files first so a file can become a directory in the next checkout.
function collect(dir = '') {
  return readdirSync(join(source, dir)).flatMap((name) => {
    if (excluded.has(name) || name.endsWith('.tsbuildinfo')) return []
    const path = join(dir, name)
    return lstatSync(join(source, path)).isDirectory() ? collect(path) : [path]
  })
}
const current = new Set(collect())
for (const path of Object.keys(previous)) if (!current.has(path)) rmSync(join(target, path), { force: true })
sync()
const library = createHash('sha256')
for (const [path, hash] of Object.entries(files)) {
  if (path.startsWith('selector/') || path.startsWith('server/src/shared/') ||
      ['mise.toml', 'scripts/test-ui-container.sh', 'scripts/ui-workspace.mjs'].includes(path)) library.update(path).update(hash)
}
mkdirSync(target, { recursive: true })
writeFileSync(stateFile, JSON.stringify({ files, library: library.digest('hex') }))
