import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'

type Slot = { file: string; title: string | null; note: string | null; pinnedAt: string | null }

/**
 * A name, note and pin belong to a save, not to its slot. Ren'Py moves quick saves and autosaves
 * up one slot when it saves, and the runtime sends the files as it finds them, so the tests drive
 * the routes the runtime uses, in each order the files can arrive.
 */
describe('names, notes and pins follow their save', () => {
  let root = ''
  let app: App
  const file = (slot: string) => `${slot}-LT1.save`

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-metafollow-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    const db = Db.open(cfg.dataDir)
    db.insertGame({ id: 'story', title: 'Story', status: 'installed', save_dir: 'Story-1' })
    db.close()
    app = await createApp(cfg, { startJobs: false })
  })
  afterEach(() => {
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  /** What the runtime does when the game wrote a file. */
  const put = (slot: string, text: string) => request(app.app).put(`/api/saves/story/file?path=Story-1/${file(slot)}`).set('content-type', 'application/octet-stream').send(Buffer.from(text)).expect(200)
  const meta = (slot: string, body: object) => request(app.app).put(`/api/saves/story/meta?file=${file(slot)}`).send(body).expect(200)
  const slots = async () => (await request(app.app).get('/api/saves/story').expect(200)).body.slots as Slot[]
  const slot = async (name: string) => (await slots()).find((s) => s.file === file(name))
  const text = async (name: string) => (await app.saves.read('Story-1', file(name))).toString()

  /** Ren'Py's quick save: it renames every slot up one, then writes the new save to the first. */
  const orders = {
    'in the order Ren’Py makes them (the shifted saves, then the new one)': async (shifted: Array<[string, string]>, fresh: [string, string]) => {
      for (const [name, data] of shifted) await put(name, data)
      await put(...fresh)
    },
    'in the order of the folder (the new save first)': async (shifted: Array<[string, string]>, fresh: [string, string]) => {
      await put(...fresh)
      for (const [name, data] of [...shifted].reverse()) await put(name, data)
    },
  }

  describe.each(Object.entries(orders))('a quick save, %s', (_when, rotate) => {
    it('moves a name to the slot its save went to, and the new save has none', async () => {
      await put('quick-1', 'the lake')
      await meta('quick-1', { title: 'Before the storm' })
      await rotate([['quick-2', 'the lake']], ['quick-1', 'the pier'])
      expect(await slot('quick-2')).toMatchObject({ title: 'Before the storm' })
      expect(await slot('quick-1')).toMatchObject({ title: null, note: null, pinnedAt: null })
      expect(await text('quick-2')).toBe('the lake')
      expect(await text('quick-1')).toBe('the pier')
    })

    it('moves a pin, and the new save is not pinned', async () => {
      await put('quick-1', 'the lake')
      await meta('quick-1', { pinned: true })
      await rotate([['quick-2', 'the lake']], ['quick-1', 'the pier'])
      expect((await slot('quick-2'))!.pinnedAt).toMatch(/^\d{4}-/)
      expect((await slot('quick-1'))!.pinnedAt).toBeNull()
    })

    it('moves a note, and the new save has none', async () => {
      await put('quick-1', 'the lake')
      await meta('quick-1', { note: 'Choose the pier next time.' })
      await rotate([['quick-2', 'the lake']], ['quick-1', 'the pier'])
      expect(await slot('quick-2')).toMatchObject({ note: 'Choose the pier next time.' })
      expect((await slot('quick-1'))!.note).toBeNull()
    })

    it('moves every name along a chain of saves, each to its own', async () => {
      await put('quick-1', 'the lake')
      await put('quick-2', 'the town')
      await meta('quick-1', { title: 'The lake' })
      await meta('quick-2', { title: 'The town', pinned: true })
      await rotate([['quick-3', 'the town'], ['quick-2', 'the lake']], ['quick-1', 'the pier'])
      expect(await slot('quick-3')).toMatchObject({ title: 'The town' })
      expect((await slot('quick-3'))!.pinnedAt).not.toBeNull()
      expect(await slot('quick-2')).toMatchObject({ title: 'The lake', pinnedAt: null })
      expect(await slot('quick-1')).toMatchObject({ title: null, pinnedAt: null })
    })

    it('keeps the old save in History as it was', async () => {
      await put('quick-1', 'the lake')
      await meta('quick-1', { title: 'Before the storm' })
      await rotate([['quick-2', 'the lake']], ['quick-1', 'the pier'])
      const versions = (await request(app.app).get('/api/saves/story/history?file=' + file('quick-1')).expect(200)).body.versions as Array<{ id: string }>
      expect(versions).toHaveLength(1)
    })

    it('does the same for autosaves', async () => {
      await put('auto-1', 'the lake')
      await put('auto-2', 'the town')
      await meta('auto-1', { title: 'The lake', note: 'A note' })
      await meta('auto-2', { pinned: true })
      await rotate([['auto-3', 'the town'], ['auto-2', 'the lake']], ['auto-1', 'the pier'])
      expect(await slot('auto-2')).toMatchObject({ title: 'The lake', note: 'A note', pinnedAt: null })
      expect((await slot('auto-3'))!.pinnedAt).not.toBeNull()
      expect(await slot('auto-1')).toMatchObject({ title: null, note: null, pinnedAt: null })
    })
  })

  describe('a pin stays on its slot when the slot is saved over in place', () => {
    const tag = (data: string) => createHash('sha1').update(data).digest('hex').slice(0, 10)
    const versions = async (name: string) => (await request(app.app).get('/api/saves/story/history?file=' + file(name)).expect(200)).body.versions as Array<{ id: string }>

    it('keeps a pinned manual slot pinned, and its name and note follow the old content', async () => {
      await put('3-1', 'chapter one')
      await meta('3-1', { pinned: true, title: 'Chapter one', note: 'Before the fight' })
      await put('3-1', 'chapter two')
      expect((await slot('3-1'))!.pinnedAt).toMatch(/^\d{4}-/)
      expect(await slot('3-1')).toMatchObject({ title: null, note: null })
    })

    it('keeps the first pinned content in the history however often the slot is saved over', async () => {
      await put('3-1', 'the first save')
      await meta('3-1', { pinned: true })
      const limit = loadConfig().saveHistoryVersions
      for (let i = 0; i < limit + 5; i++) await put('3-1', `save ${i}`)
      const list = await versions('3-1')
      expect(list).toHaveLength(limit + 5)
      expect(list.some((v) => v.id.endsWith('__' + tag('the first save')))).toBe(true)
      expect((await slot('3-1'))!.pinnedAt).not.toBeNull()
    })

    it('keeps the pinned content when the pin was given to a save that was already written over', async () => {
      await put('3-1', 'the first save')
      await meta('3-1', { pinned: true })
      await put('3-1', 'the second save')
      await put('3-1', 'the first save')
      await put('3-1', 'the third save')
      expect((await slot('3-1'))!.pinnedAt).not.toBeNull()
    })

    it('does not prune a version of a slot while the slot is pinned, in a quick save that has not rotated yet', async () => {
      await put('quick-1', 'the lake')
      await meta('quick-1', { pinned: true })
      const limit = loadConfig().saveHistoryVersions
      for (let i = 0; i < limit + 3; i++) await put('quick-1', `the pier ${i}`)
      expect((await versions('quick-1')).some((v) => v.id.endsWith('__' + tag('the lake')))).toBe(true)
    })

    it('still moves a pin when a quick save rotates, and the slot it left is no longer pinned', async () => {
      await put('quick-1', 'the lake')
      await meta('quick-1', { pinned: true, title: 'The lake' })
      await put('quick-2', 'the lake')
      await put('quick-1', 'the pier')
      expect(await slot('quick-2')).toMatchObject({ title: 'The lake' })
      expect((await slot('quick-2'))!.pinnedAt).not.toBeNull()
      expect((await slot('quick-1'))!.pinnedAt).toBeNull()
    })

    it('moves a pin that stayed on the slot when the new save was written first, once its old save turns up', async () => {
      await put('quick-1', 'the lake')
      await meta('quick-1', { pinned: true })
      await put('quick-1', 'the pier')
      expect((await slot('quick-1'))!.pinnedAt).not.toBeNull()
      await put('quick-2', 'the lake')
      expect((await slot('quick-2'))!.pinnedAt).not.toBeNull()
      expect((await slot('quick-1'))!.pinnedAt).toBeNull()
    })

    it('keeps the pin on a slot restored from History to its pinned content', async () => {
      await put('3-1', 'the lake')
      await meta('3-1', { pinned: true, title: 'The lake' })
      await put('3-1', 'the pier')
      const [version] = (await versions('3-1'))
      await request(app.app).post('/api/saves/story/history/restore').send({ id: version!.id }).expect(200)
      await put('quick-2', 'the pier')
      expect(await slot('3-1')).toMatchObject({ title: 'The lake' })
      expect((await slot('3-1'))!.pinnedAt).not.toBeNull()
    })
  })

  it('never gives a name to a save that was not named: an unrelated write takes nothing', async () => {
    await put('quick-1', 'the lake')
    await meta('quick-1', { title: 'Before the storm', note: 'A note', pinned: true })
    await put('quick-2', 'something else')
    await put('3-1', 'another page')
    expect(await slot('quick-2')).toMatchObject({ title: null, note: null, pinnedAt: null })
    expect(await slot('3-1')).toMatchObject({ title: null, note: null, pinnedAt: null })
    expect(await slot('quick-1')).toMatchObject({ title: 'Before the storm', note: 'A note' })
  })

  it('does not give a name to the new save of a slot, nor to a save written long after', async () => {
    await put('quick-1', 'the lake')
    await meta('quick-1', { title: 'Before the storm' })
    await put('quick-1', 'the pier')
    expect(await slot('quick-1')).toMatchObject({ title: null })
    await put('quick-3', 'the harbour')
    expect(await slot('quick-3')).toMatchObject({ title: null })
    expect((await slots()).filter((s) => s.title)).toEqual([])
  })

  it('keeps the name when the same file is written again', async () => {
    await put('quick-1', 'the lake')
    await meta('quick-1', { title: 'Before the storm' })
    await put('quick-1', 'the lake')
    expect(await slot('quick-1')).toMatchObject({ title: 'Before the storm' })
  })

  it('gives the name back when its save is restored from History', async () => {
    await put('quick-1', 'the lake')
    await meta('quick-1', { title: 'Before the storm' })
    await put('quick-1', 'the pier')
    expect(await slot('quick-1')).toMatchObject({ title: null })
    const [version] = (await request(app.app).get('/api/saves/story/history?file=' + file('quick-1')).expect(200)).body.versions as Array<{ id: string }>
    await request(app.app).post('/api/saves/story/history/restore').send({ id: version!.id }).expect(200)
    expect(await text('quick-1')).toBe('the lake')
    expect(await slot('quick-1')).toMatchObject({ title: 'Before the storm' })
  })

  it('forgets the name of a save that was deleted', async () => {
    await put('quick-1', 'the lake')
    await meta('quick-1', { title: 'Before the storm' })
    await request(app.app).delete('/api/saves/story/slot?file=' + file('quick-1')).expect(200)
    await put('quick-2', 'the lake')
    expect(await slot('quick-2')).toMatchObject({ title: null })
  })

  it('moves the name of a save that was named before this release remembered what it held', async () => {
    await put('quick-1', 'the lake')
    await meta('quick-1', { title: 'Before the storm' })
    // A row from an earlier release has no record of the save it belongs to.
    app.db.raw.prepare("UPDATE save_meta SET hash = ''").run()
    await put('quick-2', 'the lake')
    await put('quick-1', 'the pier')
    expect(await slot('quick-2')).toMatchObject({ title: 'Before the storm' })
    expect(await slot('quick-1')).toMatchObject({ title: null })
  })
})
