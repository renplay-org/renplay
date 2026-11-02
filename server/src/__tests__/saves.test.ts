import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { readSaveMeta, readZipEntries, slotInfo } from '../saves/savefile.js'
import { SaveStore } from '../saves/store.js'

function zip(entries: Record<string, Buffer | string>): Promise<Buffer> {
  return new Promise((resolve) => {
    const z = new yazl.ZipFile()
    for (const [k, v] of Object.entries(entries)) z.addBuffer(Buffer.from(v), k)
    z.end()
    const chunks: Buffer[] = []
    z.outputStream.on('data', (c: Buffer) => chunks.push(c))
    z.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

const saveFile = (name: string) =>
  zip({ log: 'pickled-log', json: JSON.stringify({ _save_name: name, _ctime: 1700000000, _renpy_version: [8, 5, 3, 1] }), extra_info: name, 'screenshot.png': 'PNGDATA', renpy_version: '8.5.3' })

describe('SaveStore', () => {
  let store: SaveStore
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'saves-'))
    store = new SaveStore(join(root, 'saves'), join(root, 'history'), 3)
  })

  it('writes, keeps history on overwrite, and restores', async () => {
    await store.write('Game-1', '1-1-LT1.save', Buffer.from('v1'))
    await store.write('Game-1', '1-1-LT1.save', Buffer.from('v2'))
    await store.write('Game-1', '1-1-LT1.save', Buffer.from('v2')) // identical: no new version
    expect((await store.read('Game-1', '1-1-LT1.save')).toString()).toBe('v2')
    const hist = await store.history('Game-1', '1-1-LT1.save')
    expect(hist).toHaveLength(1)
    await store.restoreVersion('Game-1', hist[0]!.id)
    expect((await store.read('Game-1', '1-1-LT1.save')).toString()).toBe('v1')
  })

  it('prunes history to the configured number of versions', async () => {
    for (let i = 0; i < 6; i++) await store.write('G', 'persistent', Buffer.from(`v${i}`))
    expect((await store.history('G', 'persistent')).length).toBe(3)
  })

  it('keeps a version when a save is deleted', async () => {
    await store.write('G', 'auto-1-LT1.save', Buffer.from('x'))
    expect(await store.remove('G', 'auto-1-LT1.save')).toBe(true)
    expect(await store.list('G')).toEqual([])
    expect((await store.history('G'))[0]?.reason).toBe('delete')
  })

  it('rejects path traversal and junk names', async () => {
    await expect(store.write('G', '../evil', Buffer.from('x'))).rejects.toThrow()
    await expect(store.write('../x', 'a', Buffer.from('x'))).rejects.toThrow()
    await expect(store.write('G', 'persistent.new', Buffer.from('x'))).rejects.toThrow()
  })

  it('imports single saves, persistent files and bundles in common layouts', async () => {
    const a = await saveFile('Alpha')
    const r1 = await store.importFiles('Game-1', [
      { filename: '1-1-LT1.save', data: a },
      { filename: 'persistent', data: Buffer.from('p') },
      { filename: 'notes.txt', data: Buffer.from('?') },
    ])
    expect(r1.imported).toEqual(['1-1-LT1.save', 'persistent'])
    expect(r1.skipped).toHaveLength(1)

    // Desktop layout: RenPy/<save dir>/..., plus another game's folder.
    const bundle = await zip({ 'Game-1/2-1-LT1.save': await saveFile('Beta'), 'Other-9/1-1-LT1.save': await saveFile('Nope') })
    const r2 = await store.importFiles('Game-1', [{ filename: 'saves.zip', data: bundle }])
    expect(r2.imported).toEqual(['2-1-LT1.save'])

    // A zip of loose files at the root.
    const flat = await zip({ '3-1-LT1.save': await saveFile('Gamma') })
    expect((await store.importFiles('Game-1', [{ filename: 'x.zip', data: flat }])).imported).toEqual(['3-1-LT1.save'])

    // An invalid .save is refused.
    const bad = await store.importFiles('Game-1', [{ filename: '9-9-LT1.save', data: Buffer.from('not a zip') }])
    expect(bad.imported).toEqual([])
  })

  it('merges security keys from another device', async () => {
    const text = 'signing-key AAAA BBBB\nverifying-key CCCC\n'
    const r = await store.importFiles('G', [{ filename: 'security_keys.txt', data: Buffer.from(text) }])
    expect(r.trustedKeys).toBe(2)
    const keys = readFileSync(join(root, 'saves', 'tokens', 'security_keys.txt'), 'utf-8')
    expect(keys).toBe('verifying-key BBBB\nverifying-key CCCC\n')
    expect(await store.mergeSecurityKeys(text)).toBe(0)
  })

  it('copies a save into another folder without overwriting', async () => {
    await store.write('S1', '5-2-LT1.save', Buffer.from('end of s1'))
    await store.write('S2', '5-2-LT1.save', Buffer.from('s2 save'))
    const name = await store.copySave('S1', '5-2-LT1.save', 'S2')
    expect(name).toBe('5-1-LT1.save')
    expect((await store.read('S2', name)).toString()).toBe('end of s1')
    expect((await store.read('S2', '5-2-LT1.save')).toString()).toBe('s2 save')
  })

  it('exports a desktop-compatible zip', async () => {
    await store.write('G', '1-1-LT1.save', Buffer.from('x'))
    await store.mergeSecurityKeys('verifying-key ZZZZ')
    const out = new PassThrough()
    const chunks: Buffer[] = []
    out.on('data', (c) => chunks.push(c))
    await store.exportZip(['G'], out, { includeTokens: true })
    const entries = await readZipEntries(Buffer.concat(chunks), () => true)
    expect([...entries.keys()].sort()).toEqual(['G/1-1-LT1.save', 'tokens/security_keys.txt'])
  })
})

describe('save files', () => {
  it('reads metadata', async () => {
    const meta = await readSaveMeta(await saveFile('Chapter 2'))
    expect(meta).toMatchObject({ name: 'Chapter 2', ctime: 1700000000, renpyVersion: '8.5.3.1', hasScreenshot: true })
  })

  it('names slots', () => {
    expect(slotInfo('3-2-LT1.save')).toMatchObject({ kind: 'manual', page: '3', slot: '2' })
    expect(slotInfo('auto-4-LT1.save').kind).toBe('auto')
    expect(slotInfo('quick-1-LT1.save').kind).toBe('quick')
    expect(slotInfo('_reload-1-LT1.save').kind).toBe('internal')
  })
})
