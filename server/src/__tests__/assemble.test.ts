import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { JobContext } from '../jobs.js'
import { openZip, readAll } from '../pipeline/archive.js'
import yauzl from 'yauzl'
import { assemble } from '../pipeline/assemble.js'
import { PackReader, PackWriter, writeIndex } from '../pipeline/pack.js'
import { buildRules, excluder, makePlaceholder, parseRules } from '../pipeline/progressive.js'

const ctx = { id: 't', params: {}, signal: new AbortController().signal, progress() {}, log() {}, checkAbort() {} } as JobContext

async function engineZip(dir: string): Promise<string> {
  const z = new yazl.ZipFile()
  z.addBuffer(Buffer.from('print("main")'), 'main.py')
  z.addBuffer(Buffer.from('renpy'), 'renpy/__init__.pyc')
  z.end()
  const p = join(dir, 'renpy.zip')
  await pipeline(z.outputStream, createWriteStream(p))
  return p
}

describe('assemble', () => {
  it('builds game.zip like Ren’Py’s web build, from packs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'asm-'))
    const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#335' } }).png().toBuffer()
    const rules = parseRules(buildRules(['images/menu.png']))
    const assets = new PackWriter(join(dir, 'assets.pack'))
    const zipPack = new PackWriter(join(dir, 'zip.pack'))
    await assets.add('images/bg.png', png)
    await assets.add('audio/theme.ogg', Buffer.from('OggS'))
    const w = await assets.begin('movies/intro.webm')
    await w.write(Buffer.from('we'))
    await w.write(Buffer.from('bm'))
    await w.end()
    expect(assets.alias('images/bg copy.png', 'images/bg.png')).toBe(true)
    await zipPack.add('images/menu.png', png)
    await zipPack.add('gui/button.png', png)
    await zipPack.add('script.rpyc', Buffer.from('RENPY RPC2'))
    await assets.close()
    await zipPack.close()
    const ph = (await makePlaceholder(png))!
    const placeholders = new Map([
      ['images/bg.png', ph],
      ['images/bg copy.png', ph],
    ])
    const res = await assemble({
      dir,
      renpyZip: await engineZip(dir),
      zipPack: { path: join(dir, 'zip.pack'), index: zipPack.index },
      assets: assets.index,
      rules,
      placeholders,
      extra: new Map([['zz_patch.rpy', Buffer.from('init: pass')]]),
      ctx,
    })
    expect(res.streamed.files).toBe(4)

    const src = await openZip(join(dir, 'game.zip'))
    const names = src.entries.map((e) => e.path).sort()
    expect(names).toEqual(
      [
        '_placeholders/images/bg copy.png',
        '_placeholders/images/bg.png',
        'game/gui/button.png',
        'game/images/menu.png',
        'game/renpyweb_remote_files.txt',
        'game/script.rpyc',
        'game/zz_patch.rpy',
        'main.py',
        'renpy/__init__.pyc',
      ].sort(),
    )
    const list = (await readAll(await src.entries.find((e) => e.path === 'game/renpyweb_remote_files.txt')!.open())).toString()
    expect(list).toBe('audio/theme.ogg\nmusic -\nimages/bg copy.png\nimage 1280,720\nimages/bg.png\nimage 1280,720\nmovies/intro.webm\nvideo -\n')
    expect((await readAll(await src.entries.find((e) => e.path === 'game/gui/button.png')!.open())).equals(png)).toBe(true)
    src.close()

    // Folders of streamed files exist after unpacking (the engine needs them).
    const dirs: string[] = []
    await new Promise<void>((resolve) => {
      yauzl.open(join(dir, 'game.zip'), { lazyEntries: true }, (_e, z) => {
        z!.on('entry', (e) => {
          if (e.fileName.endsWith('/')) dirs.push(e.fileName)
          z!.readEntry()
        })
        z!.on('end', () => resolve())
        z!.readEntry()
      })
    })
    expect(dirs.sort()).toEqual(['game/audio/', 'game/images/', 'game/movies/'])

    // The assets pack serves every streamed file back, aliases included.
    await writeIndex(join(dir, 'assets.json'), assets.index)
    const reader = new PackReader(join(dir, 'assets.pack'), join(dir, 'assets.json'))
    expect((await reader.read('movies/intro.webm'))?.toString()).toBe('webm')
    expect((await reader.read('images/bg copy.png'))?.equals(png)).toBe(true)
  })

  it('matches exclude globs relative to game/', () => {
    const ex = excluder(['**/*.psd', 'game/old/**'])
    expect(ex('images/a.psd')).toBe(true)
    expect(ex('old/x.png')).toBe(true)
    expect(ex('images/a.png')).toBe(false)
  })
})
