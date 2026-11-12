import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { JobContext } from '../jobs/manager.js'
import type { ArchiveSource } from '../pipeline/archive.js'
import { MAX_IMAGE_BYTES } from '../pipeline/image-memory.js'
import { ImageProcessor, defaultImagePolicy } from '../pipeline/optimize.js'
import { PackWriter } from '../pipeline/pack.js'
import { extractProject } from '../pipeline/project.js'
import { DEFAULT_PROGRESSIVE_RULES, parseRules } from '../pipeline/progressive.js'

const ctx: JobContext = { id: 'test', params: {}, signal: new AbortController().signal, progress() {}, log() {}, checkAbort() {} }

describe('project extraction memory', () => {
  it('reserves a task slot before reading each loose image', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'project-memory-'))
    const assets = new PackWriter(join(dir, 'assets.pack'))
    const zip = new PackWriter(join(dir, 'zip.pack'))
    let retained = 0
    let peak = 0
    const process = vi.spyOn(ImageProcessor.prototype, 'process').mockImplementation(async (data) => {
      await new Promise((resolve) => setImmediate(resolve))
      retained--
      return { data, changed: false, placeholder: null }
    })
    const src: ArchiveSource = {
      kind: 'zip', close() {},
      entries: Array.from({ length: 40 }, (_, i) => ({
        path: `Game with spaces/game/images/scene ${i}.jpg`, size: 16384, seekable: false,
        open: async () => {
          retained++
          peak = Math.max(peak, retained)
          return Readable.from([Buffer.alloc(16384)])
        },
      })),
    }
    try {
      await extractProject(src, 'Game with spaces/', dir, defaultImagePolicy(), 4, ctx, [], { assets, zip, skip: new Set() })
      expect(peak).toBe(4)
      expect(retained).toBe(0)
      expect(process).toHaveBeenCalledTimes(40)
    } finally {
      process.mockRestore()
      await Promise.all([assets.close(), zip.close()])
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('streams an oversized loose image without sending its body to sharp', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'project-large-'))
    const assets = new PackWriter(join(dir, 'assets.pack'))
    const zip = new PackWriter(join(dir, 'zip.pack'))
    const process = vi.spyOn(ImageProcessor.prototype, 'process')
    const chunk = Buffer.alloc(64 << 10)
    const size = MAX_IMAGE_BYTES + chunk.length
    const src: ArchiveSource = {
      kind: 'zip', close() {}, entries: [{
        path: 'Game/game/images_2160/huge image.jpg', size, seekable: false,
        open: async () => Readable.from((async function* () {
          for (let n = 0; n < size; n += chunk.length) yield chunk
        })(), { objectMode: false, highWaterMark: chunk.length }),
      }],
    }
    try {
      const result = await extractProject(src, 'Game/', dir, defaultImagePolicy(), 4, ctx, parseRules(DEFAULT_PROGRESSIVE_RULES), { assets, zip, skip: new Set() })
      await zip.close()
      expect(process).not.toHaveBeenCalled()
      expect(result.placeholders.size).toBe(0)
      expect(zip.index.get('images_2160/huge image.jpg')).toEqual([0, size])
      expect(statSync(zip.path).size).toBe(size)
    } finally {
      process.mockRestore()
      await Promise.all([assets.close(), zip.close()])
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('gives a Ren\'Py 6 game the theme pictures of its download, unless it has its own', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'project-common-'))
    const assets = new PackWriter(join(dir, 'assets.pack'))
    const zip = new PackWriter(join(dir, 'zip.pack'))
    const process = vi.spyOn(ImageProcessor.prototype, 'process').mockImplementation(async (data) => ({ data, changed: false, placeholder: null }))
    const file = (path: string, text: string) => ({ path, size: text.length, seekable: false, open: async () => Readable.from([Buffer.from(text)]) })
    const src: ArchiveSource = {
      kind: 'zip', close() {}, entries: [
        file('OldGame-1.0-pc/game/script.rpyc', 'script'),
        file('OldGame-1.0-pc/common/_theme_glow/g_box.png', 'shipped'),
        file('OldGame-1.0-pc/common/_roundrect/rr12g.png', 'shipped'),
        file('OldGame-1.0-pc/game/_roundrect/rr12g.png', 'own'),
        file('OldGame-1.0-pc/common/00library.rpy', 'engine script'),
      ],
    }
    try {
      await extractProject(src, 'OldGame-1.0-pc/', dir, defaultImagePolicy(), 4, ctx, [], { assets, zip, skip: new Set() })
      await Promise.all([assets.close(), zip.close()])
      const read = (name: string) => {
        const [pack, at] = zip.index.has(name) ? [zip, zip.index.get(name)!] : [assets, assets.index.get(name)!]
        return readFileSync(pack.path).subarray(at[0], at[0] + at[1]).toString()
      }
      expect([...zip.index.keys(), ...assets.index.keys()].sort()).toEqual(['_roundrect/rr12g.png', '_theme_glow/g_box.png', 'script.rpyc'])
      expect([read('_theme_glow/g_box.png'), read('_roundrect/rr12g.png')]).toEqual(['shipped', 'own'])
    } finally {
      process.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
