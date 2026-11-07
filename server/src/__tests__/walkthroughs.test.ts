import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, type App } from '../app.js'
import { loadConfig } from '../config.js'
import { Db } from '../db.js'
import { walkthroughKind } from '../routes/games.js'

describe('walkthrough files', () => {
  let root = ''
  let app: App
  let dir = ''

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renplay-walk-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    process.env['RENPLAY_AUTH'] = 'off'
    process.env['RENPLAY_CATALOG_URLS'] = 'http://127.0.0.1:9/none'
    process.env['RENPLAY_ENGINES_URL'] = 'http://127.0.0.1:9/none'
    const cfg = loadConfig()
    dir = cfg.walkthroughsDir
    // A 3.x library with one PDF walkthrough: the migration makes it the first file.
    const db = Db.open(cfg.dataDir)
    db.raw.exec('DROP TABLE walkthroughs; PRAGMA user_version = 14')
    db.insertGame({ id: 'story', title: 'Story', status: 'installed', walkthrough: 'story-old.pdf' })
    db.close()
    app = await createApp(cfg, { startJobs: false })
  })
  afterAll(() => {
    app?.close()
    rmSync(root, { recursive: true, force: true })
    for (const k of ['DATA_DIR', 'GAMES_DIR', 'RENPLAY_AUTH', 'RENPLAY_CATALOG_URLS', 'RENPLAY_ENGINES_URL']) delete process.env[k]
  })

  const files = async () => (await request(app.app).get('/api/games/story').expect(200)).body.game.walkthroughs as Array<{ file: string; title: string; kind: string }>

  it('turns a 3.x walkthrough into the first file of the list', async () => {
    expect(await files()).toEqual([expect.objectContaining({ file: 'story-old.pdf', title: 'Walkthrough', kind: 'pdf' })])
  })

  it('takes PDFs, pictures and plain text, and refuses HTML and anything else', () => {
    expect(walkthroughKind(Buffer.from('%PDF-1.7 x'))).toEqual({ kind: 'pdf', ext: 'pdf' })
    expect(walkthroughKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toEqual({ kind: 'image', ext: 'png' })
    expect(walkthroughKind(Buffer.from('Chapter 1: choose the lake.'), 'guide.md')).toEqual({ kind: 'text', ext: 'txt' })
    expect(walkthroughKind(Buffer.from('<!doctype html><script>x</script>'), 'guide.txt')).toBeNull()
    expect(walkthroughKind(Buffer.from('plain words'), 'guide.html')).toBeNull()
    expect(walkthroughKind(Buffer.from('MZ binary'), 'guide.exe')).toBeNull()
  })

  it('adds, renames, orders and removes files, keeping games.walkthrough the first one for 3.x', async () => {
    const added = (await request(app.app).post('/api/games/story/walkthroughs').attach('file', Buffer.from('Route A: be kind.'), 'Routes and endings.md').expect(200)).body.game.walkthroughs
    expect(added.map((w: { title: string; kind: string }) => [w.title, w.kind])).toEqual([['Walkthrough', 'pdf'], ['Routes and endings', 'text']])
    const text = added[1]
    const served = await request(app.app).get(text.url).expect(200)
    expect(served.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(served.headers['x-content-type-options']).toBe('nosniff')
    await request(app.app).post('/api/games/story/walkthroughs').attach('file', Buffer.from('<html>no</html>'), 'page.html').expect(400)

    await request(app.app).put(`/api/games/story/walkthroughs/${text.file}`).send({ title: 'Endings' }).expect(200)
    await request(app.app).put(`/api/games/story/walkthroughs/${text.file}`).send({ position: 0 }).expect(200)
    expect((await files()).map((w) => w.title)).toEqual(['Endings', 'Walkthrough'])
    expect(app.db.getGame('story')!.walkthrough).toBe(text.file)
    await request(app.app).put(`/api/games/story/walkthroughs/${text.file}`).send({ title: '  ' }).expect(400)

    await request(app.app).delete(`/api/games/story/walkthroughs/${text.file}`).expect(200)
    expect(existsSync(join(dir, text.file))).toBe(false)
    expect((await files()).map((w) => w.file)).toEqual(['story-old.pdf'])
    expect(app.db.getGame('story')!.walkthrough).toBe('story-old.pdf')
    await request(app.app).delete('/api/games/story/walkthroughs/not-there.pdf').expect(404)
  })
})
