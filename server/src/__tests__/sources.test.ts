import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setSourcesAside } from '../pipeline/import.js'
import { PackReader, PackWriter, writeIndex } from '../pipeline/pack.js'

describe('script sources', () => {
  it('leave game.zip when their compiled script is there, and stay in the build', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'renplay-sources-'))
    const zip = new PackWriter(join(dir, 'zip.pack'))
    const assets = new PackWriter(join(dir, 'assets.pack'))
    await zip.add('script.rpy', Buffer.from('label start:\n    "Hi"\n'))
    await zip.add('script.rpyc', Buffer.from('RENPY RPC2...'))
    await zip.add('lib/tools.rpym', Buffer.from('init python: pass\n'))
    await zip.add('lib/tools.rpymc', Buffer.from('RENPY RPC2...'))
    // A recipe patch or a game file with no compiled script stays where Ren'Py sees it.
    await zip.add('zz_fix.rpy', Buffer.from('init 999 python: pass\n'))
    await zip.close()
    expect(await setSourcesAside(join(dir, 'zip.pack'), zip, assets)).toBe(2)
    expect([...zip.index.keys()].sort()).toEqual(['lib/tools.rpymc', 'script.rpyc', 'zz_fix.rpy'])
    await assets.close()
    await writeIndex(join(dir, 'assets.json'), assets.index)
    const reader = new PackReader(join(dir, 'assets.pack'), join(dir, 'assets.json'))
    expect((await reader.read('script.rpy'))?.toString()).toBe('label start:\n    "Hi"\n')
    expect((await reader.read('lib/tools.rpym'))?.toString()).toBe('init python: pass\n')
  })
})
