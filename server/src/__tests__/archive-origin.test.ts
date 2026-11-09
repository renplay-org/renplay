import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishUpload } from '../library/archives.js'

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, rename: vi.fn(fs.rename) }
})
const roots: string[] = []
afterEach(async () => {
  vi.mocked(rename).mockClear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
describe('publishUpload', () => {
  for (const crossFilesystem of [false, true]) {
    it(`publishes a complete upload with cross-filesystem=${crossFilesystem}`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'renplay-publish-'))
      roots.push(root)
      const source = join(root, 'part'), destination = join(root, 'Game.zip')
      await writeFile(source, 'complete download')
      if (crossFilesystem) vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('cross-device link'), { code: 'EXDEV' }))
      await publishUpload(source, destination)
      expect(await readFile(destination, 'utf8')).toBe('complete download')
      expect(await readdir(root)).toEqual(['Game.zip'])
    })
  }
  it('does not copy or remove the source on permission errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renplay-publish-'))
    roots.push(root)
    const source = join(root, 'part')
    await writeFile(source, 'download')
    vi.mocked(rename).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    await expect(publishUpload(source, join(root, 'Game.zip'))).rejects.toThrow('denied')
    expect(await readdir(root)).toEqual(['part'])
  })
})
