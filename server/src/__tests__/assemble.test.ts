import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import yazl from 'yazl'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { JobContext } from '../jobs.js'
import { openZip, readAll } from '../pipeline/archive.js'
import { assemble } from '../pipeline/assemble.js'
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
  it('builds game.zip like Ren’Py’s web build', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'asm-'))
    const g = join(dir, 'build', 'game')
    for (const d of ['images', 'gui', 'audio', 'movies']) mkdirSync(join(g, d), { recursive: true })
    const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#335' } }).png().toBuffer()
    writeFileSync(join(g, 'images', 'bg.png'), png)
    writeFileSync(join(g, 'images', 'menu.png'), png)
    writeFileSync(join(g, 'gui', 'button.png'), png)
    writeFileSync(join(g, 'audio', 'theme.ogg'), 'OggS')
    writeFileSync(join(g, 'movies', 'intro.webm'), 'webm')
    writeFileSync(join(g, 'script.rpyc'), 'RENPY RPC2')
    const placeholders = new Map([
      ['images/bg.png', (await makePlaceholder(png))!],
      ['images/menu.png', (await makePlaceholder(png))!],
    ])
    const res = await assemble({
      dir: join(dir, 'build'),
      renpyZip: await engineZip(dir),
      rules: parseRules(buildRules(['images/menu.png'])),
      placeholders,
      ctx,
    })
    expect(res.streamed.files).toBe(3)

    const src = await openZip(join(dir, 'build', 'game.zip'))
    const names = src.entries.map((e) => e.path).sort()
    // Folders of streamed files exist after unpacking (the engine needs them).
    const dirs: string[] = []
    await new Promise<void>((resolve) => {
      import('yauzl').then(({ default: yauzl }) =>
        yauzl.open(join(dir, 'build', 'game.zip'), { lazyEntries: true }, (_e, z) => {
          z!.on('entry', (e) => {
            if (e.fileName.endsWith('/')) dirs.push(e.fileName)
            z!.readEntry()
          })
          z!.on('end', () => resolve())
          z!.readEntry()
        }),
      )
    })
    expect(dirs.sort()).toEqual(['game/audio/', 'game/images/', 'game/movies/'])
    expect(names).toEqual(
      ['_placeholders/images/bg.png', 'game/gui/button.png', 'game/images/menu.png', 'game/renpyweb_remote_files.txt', 'game/script.rpyc', 'main.py', 'renpy/__init__.pyc'].sort(),
    )
    const list = (await readAll(await src.entries.find((e) => e.path === 'game/renpyweb_remote_files.txt')!.open())).toString()
    expect(list).toBe('audio/theme.ogg\nmusic -\nimages/bg.png\nimage 1280,720\nmovies/intro.webm\nvideo -\n')
    src.close()
    // Zipped files left the streamed folder; streamed ones stayed.
    expect(existsSync(join(g, 'script.rpyc'))).toBe(false)
    expect(existsSync(join(g, 'gui'))).toBe(false)
    expect(existsSync(join(g, 'images', 'bg.png'))).toBe(true)
    expect(existsSync(join(g, 'images', 'menu.png'))).toBe(false)
  })

  it('matches exclude globs relative to game/', () => {
    const ex = excluder(['**/*.psd', 'game/old/**'])
    expect(ex('images/a.psd')).toBe(true)
    expect(ex('old/x.png')).toBe(true)
    expect(ex('images/a.png')).toBe(false)
  })
})
