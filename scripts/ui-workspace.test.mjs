import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

const command = new URL('./ui-workspace.mjs', import.meta.url)
test('warm workspace updates sources and deletions, preserves output, and keys the library by its inputs', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'renplay-ui-workspace-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target')
  const put = (base, path, text) => {
    mkdirSync(dirname(join(base, path)), { recursive: true })
    writeFileSync(join(base, path), text)
  }
  const sync = () => {
    execFileSync(process.execPath, [command.pathname, source, target])
    return JSON.parse(readFileSync(join(target, '.ui-workspace.json'), 'utf8')).library
  }
  put(source, 'selector/src/App.tsx', 'first')
  put(source, 'server/src/shared/api.ts', 'contract')
  put(source, 'server/src/app.ts', 'server')
  put(source, 'selector/node_modules/native.node', 'Mac binary')
  put(source, 'selector/dist/index.html', 'Mac build')
  put(target, 'selector/node_modules/native.node', 'Linux binary')
  put(target, 'selector/dist/index.html', 'Linux build')
  symlinkSync('src/App.tsx', join(source, 'selector/link'))
  const first = sync()
  const unchanged = statSync(join(target, 'selector/src/App.tsx')).mtimeMs
  assert.equal(sync(), first)
  assert.equal(statSync(join(target, 'selector/src/App.tsx')).mtimeMs, unchanged)
  assert.equal(readFileSync(join(target, 'selector/link'), 'utf8'), 'first')
  assert.equal(readFileSync(join(target, 'selector/node_modules/native.node'), 'utf8'), 'Linux binary')
  assert.equal(readFileSync(join(target, 'selector/dist/index.html'), 'utf8'), 'Linux build')
  put(source, 'server/src/app.ts', 'changed server')
  assert.equal(sync(), first, 'Server-only changes do not rebuild the library')
  put(source, 'selector/src/App.tsx', 'second')
  const second = sync()
  assert.notEqual(second, first)
  assert.equal(readFileSync(join(target, 'selector/src/App.tsx'), 'utf8'), 'second')
  put(source, 'server/src/shared/api.ts', 'changed contract')
  assert.notEqual(sync(), second, 'Shared imports invalidate the library build')
  rmSync(join(source, 'selector/src/App.tsx'))
  rmSync(join(source, 'selector/link'))
  sync()
  assert.equal(existsSync(join(target, 'selector/src/App.tsx')), false)
  rmSync(join(source, 'server/src/app.ts'))
  put(source, 'server/src/app.ts/child.ts', 'replaced directory')
  sync()
  assert.equal(readFileSync(join(target, 'server/src/app.ts/child.ts'), 'utf8'), 'replaced directory')
  rmSync(join(source, 'server/src/app.ts'), { recursive: true })
  put(source, 'server/src/app.ts', 'file again')
  sync()
  assert.equal(readFileSync(join(target, 'server/src/app.ts'), 'utf8'), 'file again')
})
