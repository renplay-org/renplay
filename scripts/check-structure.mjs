// Checks the structure of the server and the library, so it stays the way it was untangled:
// no import cycles, each layer importing only what is below it, no exports nothing uses, controls
// only from the UI kit, and no source file growing past the size budget. AGENTS.md › Structure
// rules says why.
//
//   node scripts/check-structure.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(dirname(new URL(import.meta.url).pathname), '..')
const SERVER = join(root, 'server/src')
const SELECTOR = join(root, 'selector/src')
const SHARED = join(SERVER, 'shared')

/** Lines a source file may have. A few older files are larger, and may only shrink. */
const MAX_LINES = 600
const LARGER = {
  'selector/src/index.css': 2949,
  'runtime/renplay-runtime.js': 1638,
  'server/src/art/store.ts': 839,
  'selector/src/pages/GamePage.tsx': 627,
}

const problems = []
const rel = (p) => relative(root, p)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== 'dist' && name !== 'vendor') walk(p, out)
    } else out.push(p)
  }
  return out
}

const code = (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts')
const isTest = (p) => p.includes('/__tests__/')
const sources = [...walk(SERVER), ...walk(SELECTOR)].filter(code)
const text = new Map(sources.map((p) => [p, readFileSync(p, 'utf8')]))

/** Where an import points, or null for a package. */
function target(from, spec) {
  let base
  if (spec.startsWith('@shared/')) base = join(SHARED, spec.slice('@shared/'.length))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  // Styles, scripts and data files are not part of the code's graph.
  if (/\.(css|mjs|json)$/.test(base) && existsSync(base)) return null
  for (const p of [base.replace(/\.js$/, '.ts'), base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (text.has(p)) return p
  problems.push(`${rel(from)}: imports ${spec}, which does not exist`)
  return null
}

const IMPORT = /^\s*(?:import|export)\b[^'"]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm
const imports = new Map()
for (const [p, s] of text) {
  const to = new Set()
  for (const m of s.matchAll(IMPORT)) {
    const t = target(p, m[1] ?? m[2])
    if (t) to.add(t)
  }
  imports.set(p, to)
}

// ---- no import cycles ----------------------------------------------------------------------------

{
  // Tarjan's strongly connected components over the non-test graph.
  const nodes = sources.filter((p) => !isTest(p))
  let index = 0
  const idx = new Map(), low = new Map(), stack = [], on = new Set()
  const visit = (v) => {
    idx.set(v, index), low.set(v, index++), stack.push(v), on.add(v)
    for (const w of imports.get(v) ?? []) {
      if (isTest(w)) continue
      if (!idx.has(w)) visit(w), low.set(v, Math.min(low.get(v), low.get(w)))
      else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)))
    }
    if (low.get(v) === idx.get(v)) {
      const scc = []
      let w
      do (w = stack.pop()), on.delete(w), scc.push(w)
      while (w !== v)
      if (scc.length > 1) problems.push(`import cycle: ${scc.map(rel).join(' <-> ')}`)
    }
  }
  for (const v of nodes) if (!idx.has(v)) visit(v)
}

// ---- each layer imports only what is below it ------------------------------------------------------

const inside = (p, dir) => p.startsWith(join(dir, '/'))
for (const [p, to] of imports) {
  if (isTest(p)) continue
  for (const t of to) {
    const say = (why) => problems.push(`${rel(p)} imports ${rel(t)}: ${why}`)
    if (inside(p, SHARED) && !inside(t, SHARED)) say('shared/ is what the library builds with, so it imports only itself')
    if (inside(p, SELECTOR) && inside(t, SERVER) && !inside(t, SHARED)) say('the library reaches the server only through @shared')
    if ((inside(p, join(SERVER, 'pipeline')) || inside(p, join(SERVER, 'util'))) && /\/(routes|[\w-]+-routes)\.ts$|\/(services|app)\.ts$/.test(t)) say('pipeline/ and util/ sit below the routes and the services')
    if (inside(p, join(SERVER, 'util')) && !inside(t, join(SERVER, 'util')) && !inside(t, SHARED)) say('util/ imports only util/ and shared/')
    if (inside(p, join(SELECTOR, 'lantern')) && (inside(t, join(SELECTOR, 'pages')) || inside(t, join(SELECTOR, 'components')))) say('the UI kit sits below the pages and components')
    if (inside(p, join(SELECTOR, 'lib')) && (inside(t, join(SELECTOR, 'pages')) || inside(t, join(SELECTOR, 'components')))) say('lib/ sits below the pages and components')
    if (t === join(SERVER, 'services.ts') && p !== join(SERVER, 'app.ts') && !/export function create\w+Router\b/.test(text.get(p))) say('only app.ts and routers (a create…Router) get the Services')
  }
}

// ---- no exports nothing uses ---------------------------------------------------------------------
// A function or constant is exported only when another file uses it. Types may describe their own
// file's exports.

{
  const EXPORT = /^export (?:async )?(?:function|const|let|class) ([A-Za-z_$][\w$]*)/gm
  for (const [p, s] of text) {
    if (isTest(p)) continue
    for (const m of s.matchAll(EXPORT)) {
      const name = m[1], word = new RegExp(`\\b${name}\\b`)
      let used = false
      for (const [q, t] of text) if (q !== p && word.test(t)) { used = true; break }
      if (used) continue
      const local = (s.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length > 1
      problems.push(`${rel(p)}: exports ${name}, which ${local ? 'only this file uses: drop the export' : 'nothing uses: remove it'}`)
    }
  }
}

// ---- controls come from the UI kit ---------------------------------------------------------------

// The kit's button classes, written by hand outside lantern/: use Pill or IconBtn instead.
const KIT_CLASS = /className=(?:"|\{`)(?:ib|btn)(?:[ "`])/
for (const [p, s] of text) {
  if (!inside(p, SELECTOR) || inside(p, join(SELECTOR, 'lantern')) || isTest(p)) continue
  s.split('\n').forEach((line, i) => {
    if (KIT_CLASS.test(line)) problems.push(`${rel(p)}:${i + 1}: a button styled by hand. Use Pill or IconBtn from lantern/controls.tsx`)
  })
}

// ---- the size budget -----------------------------------------------------------------------------

for (const p of [...walk(SERVER), ...walk(SELECTOR), ...walk(join(root, 'runtime')), ...walk(join(root, 'scripts'))]) {
  if (isTest(p) || !/\.(ts|tsx|js|mjs|css)$/.test(p)) continue
  const lines = readFileSync(p, 'utf8').split('\n').length - 1
  const max = LARGER[rel(p)] ?? MAX_LINES
  if (lines > max) problems.push(`${rel(p)}: ${lines} lines, more than ${max}. Split it by what changes together.`)
}
for (const [p, max] of Object.entries(LARGER)) {
  try {
    const lines = readFileSync(join(root, p), 'utf8').split('\n').length - 1
    if (lines < max) problems.push(`${p} shrank to ${lines} lines: lower its budget in scripts/check-structure.mjs to match`)
  } catch {
    problems.push(`${p} is gone: remove it from LARGER in scripts/check-structure.mjs`)
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} structure ${problems.length === 1 ? 'problem' : 'problems'}. AGENTS.md › Structure rules says what each rule is for.`)
  process.exit(1)
}
console.log('The structure holds: no import cycles, layers in order, no unused exports, controls from the kit, files within budget.')
