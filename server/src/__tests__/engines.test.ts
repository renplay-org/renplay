import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Config } from '../config.js'
import { Db } from '../db.js'
import { EngineStore } from '../engines.js'
import { Purger } from '../util/purge.js'

const roots: string[] = []
const dbs: Db[] = []
beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => {
  vi.unstubAllGlobals()
  for (const d of dbs.splice(0)) d.close()
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

const FILES = Object.fromEntries(['renpy-pre.js', 'renpy.js', 'renpy.wasm.gz', 'renpy.data.gz', 'renpy.zip', 'index.html', 'web-presplash.jpg'].map((n) => [n, { size: 1, sha256: '0', url: `http://engines.test/${n}` }]))
const entry = (version: string, extra: object = {}) => ({ version, renpy: version, python: 3, files: FILES, ...extra })

/** An engine store whose index lists these engines, and whose folder holds these installed packs. */
function store(index: object[], defaultEngine = '', installed: string[] = []): EngineStore {
  const root = mkdtempSync(join(tmpdir(), 'renplay-engines-')); roots.push(root)
  const enginesDir = join(root, 'engines')
  for (const v of installed) {
    mkdirSync(join(enginesDir, v), { recursive: true })
    writeFileSync(join(enginesDir, v, '.ready'), '{}')
  }
  const db = new Db(join(root, 'library.db')); dbs.push(db)
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ schema: 1, engines: index })))
  return new EngineStore({ enginesDir, enginesUrl: 'http://engines.test/index.json', defaultEngine } as Config, db, new Purger(join(root, 'purge')))
}

const index = [entry('8.6.0', { prerelease: true }), entry('8.5.3'), entry('8.4.1'), entry('7.8.0')]

it('builds a game made with an older Ren’Py on the newest stable engine, not on a pre-release', async () => {
  const engines = store(index)
  expect(await engines.pick(undefined, '8.3.4.24120703')).toBe('8.5.3')
  expect(await engines.pick(undefined, '8.5.3.26051501')).toBe('8.5.3')
  expect(await engines.pick(undefined, '7.4.11.2')).toBe('8.5.3')
  expect(await engines.pick(undefined, undefined)).toBe('8.5.3')
})

it('builds a game made with the pre-release on the pre-release', async () => {
  const engines = store(index)
  expect(await engines.pick(undefined, '8.6.0.26110123')).toBe('8.6.0')
})

it('takes the lowest pre-release that is at least the game’s version', async () => {
  const engines = store([entry('8.7.0', { prerelease: true }), ...index])
  expect(await engines.pick(undefined, '8.6.0.26110123')).toBe('8.6.0')
  expect(await engines.pick(undefined, '8.6.1.26111000')).toBe('8.7.0')
  // Nothing is new enough: the newest stable engine, as before.
  expect(await engines.pick(undefined, '8.9.0.1')).toBe('8.5.3')
})

it('uses an engine asked for by name as it is, pre-release or not', async () => {
  const engines = store(index)
  expect(await engines.pick('8.6.0', '8.3.4.24120703')).toBe('8.6.0')
  expect(await engines.pick('8.4.1', '8.6.0.26110123')).toBe('8.4.1')
  await expect(store(index).pick('8.9.9', undefined)).rejects.toThrow('not available')
  expect(await store(index, '8.6.0').pick(undefined, '8.3.4.24120703')).toBe('8.6.0')
})

it('treats an index without the prerelease field as all stable', async () => {
  const engines = store([entry('8.6.0'), entry('8.5.3')])
  expect(await engines.pick(undefined, '8.3.4.24120703')).toBe('8.6.0')
})

it('counts an installed engine that the index does not list as stable', async () => {
  const engines = store([entry('8.5.3')], '', ['8.6.0'])
  expect(await engines.pick(undefined, '8.3.4.24120703')).toBe('8.6.0')
})
