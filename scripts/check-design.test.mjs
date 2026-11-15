import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const command = new URL('./check-design.mjs', import.meta.url).pathname

/** A repository holding these files, and what the check says about it. */
function check(files) {
  const root = mkdtempSync(join(tmpdir(), 'check-design-'))
  try {
    for (const [name, text] of Object.entries({ 'design/tokens.css': ':root { --ink: #0a0a0f; --r-2: 8px; }', ...files })) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), text)
    }
    const run = spawnSync(process.execPath, [command, root], { encoding: 'utf8' })
    return { ok: run.status === 0, said: run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a look made of tokens, white, black and transparent passes', () => {
  const css = `.a { color: var(--fg); background: rgb(255 255 255 / .1); border: 1px solid rgba(0, 0, 0, .4); border-radius: var(--r-2); }
.b { background: linear-gradient(transparent, rgba(0, 0, 0, 0.5)); font: 15px/1.4 var(--sans); border-radius: 0 var(--r-sheet) var(--r-sheet) 0; }
.c { font-family: inherit; border-radius: 50%; } /* #ff00aa and 12px in a comment */`
  assert.deepEqual(check({ 'selector/src/a.css': css }), { ok: true, said: '' })
  assert.equal(check({ 'website/pages/a.html': '<a href="#add">Add</a> &#169;' }).ok, true)
  assert.equal(check({ 'selector/src/a.tsx': 'const r = `${radius}px`; const s = { borderRadius: `${r / 2}px`, color: "var(--fg)" }' }).ok, true)
})

test('a colour, gradient, face or corner written as a literal fails, with its place', () => {
  for (const [file, text, what] of [
    ['selector/src/a.css', '.a {\n  color: #ff00aa;\n}', 'a.css:2: colour: #ff00aa'],
    ['docs/site/src/a.css', '.a { color: rgb(10 10 15 / .5); }', 'colour: rgb(10 10 15 / .5)'],
    ['website/a.css', '.a { color: salmon; }', 'named colour: salmon'],
    ['selector/src/a.css', '.a { background: linear-gradient(\n    90deg,\n    #fff,\n    #123456\n  ); }', 'gradient with a colour'],
    ['selector/src/a.css', 'body { font:\n    15px/1.45 Inter,\n    sans-serif; }', 'face: font:'],
    ['selector/src/a.css', '.a { font-family: "Fraunces", serif; }', 'face: font-family'],
    ['selector/src/a.css', '.a { border-radius: 12px; }', 'corner: 12px'],
    ['selector/src/a.css', '.a { border-radius: 0 12px 12px 0; }', 'corner: 0 12px 12px 0'],
    ['selector/src/a.tsx', 'const a = <b style={{ borderRadius: 12 }} />', 'corner: 12'],
    ['selector/src/a.tsx', 'const a = <b className="text-zinc-400 rounded-xl" />', 'Tailwind utility: text-zinc-400'],
    ['selector/src/a.tsx', 'const a = <b className="bg-white/10" />', 'Tailwind utility: bg-white/10'],
  ]) {
    const result = check({ [file]: text })
    assert.equal(result.ok, false, text)
    assert.ok(result.said.includes(what), `${text}\n${result.said}`)
  }
})

test('the game page may keep a colour only with the token it equals named after it', () => {
  assert.equal(check({ 'server/src/play/a.ts': 'const css = "html{background:#0a0a0f /* --ink */}"' }).ok, true)
  assert.match(check({ 'runtime/a.js': 'var css = "html{background:#0a0a0e /* --ink */}"' }).said, /--ink is #0a0a0f/)
  assert.match(check({ 'runtime/a.js': 'var css = "html{background:#0a0a0f}"' }).said, /a colour with no token named after it/)
  assert.match(check({ 'runtime/a.js': 'var css = "html{background:#0a0a0f /* --paper */}"' }).said, /--paper is not a token/)
})

test('the repository itself keeps within its allowances', () => {
  const run = spawnSync(process.execPath, [command], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
})
