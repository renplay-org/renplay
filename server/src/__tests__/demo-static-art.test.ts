import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { artNamed, checkArt } from '../../../demo/static/art.mjs'
import { writeSnapshot } from '../../../demo/static/snapshot.mjs'
import { demoServer } from './demo-static-fixture.js'

/**
 * What the demo server's catalog does not have here: a game the library does not hold, with art in three formats, and a
 * guest who names a picture in their own answer. Their pictures are served as the server serves art.
 */
const OTHER = { grid: ['/api/art/aa01.webp', '/api/art/aa02.webp'], hero: ['/api/art/bb01.webp', '/api/art/bb02.webp'], icon: ['/api/art/cc01.webp', '/api/art/cc02.webp'] }
const AVATAR = '/api/art/dd01.webp'
const format = ([url1x, url2x]: string[]) => ({ url1x, url2x, width: 1, height: 1, thumbhash: null, tint: '#a33', made: 'cropped' })

const withOther: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  if ([...Object.values(OTHER).flat(), AVATAR].includes(url.pathname)) return new Response(url.pathname)
  const res = await fetch(input, init)
  if (url.pathname === '/api/catalog') {
    const body = (await res.json()) as { games: Array<Record<string, unknown>> }
    body.games.push({ id: 'other', title: 'Other', art: Object.fromEntries(Object.entries(OTHER).map(([kind, pair]) => [kind, format(pair)])), local: null })
    return Response.json(body)
  }
  if (url.pathname === '/api/me') {
    const body = (await res.json()) as { user: Record<string, unknown> }
    return Response.json({ ...body, user: { ...body.user, avatar: AVATAR } })
  }
  return res
}

describe('the art of the static demo', () => {
  let server: Awaited<ReturnType<typeof demoServer>>
  let root: string

  const snapshotOf = (out: string) => readFileSync(join(out, 'demo/snapshot.json'), 'utf8')
  /** A finished output: the snapshot and its games, written from the demo server. */
  async function output(name: string): Promise<string> {
    const out = join(root, name)
    await writeSnapshot({ out, base: server.base, seed: join(root, 'seed'), embedder: 'https://renplay.org', fetch: withOther })
    return out
  }

  beforeAll(async () => {
    server = await demoServer()
    root = mkdtempSync(join(tmpdir(), 'renplay-static-art-'))
    const build = join(root, 'seed', 'games', 'the-question', 'b1')
    mkdirSync(build, { recursive: true })
    writeFileSync(join(build, 'game.zip'), 'zip')
    writeFileSync(join(build, 'assets.pack'), 'xxpng0123456789')
    writeFileSync(join(build, 'assets.json'), JSON.stringify({ 'images/a.png': [2, 3] }))
  })
  afterAll(async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('holds every picture the answers and the game pages name, and none a page cannot ask for', async () => {
    const out = await output('whole')
    expect(() => checkArt(out)).not.toThrow()
    const named = artNamed(snapshotOf(out))
    expect(named.length).toBeGreaterThan(OTHER.grid.length)
    for (const address of named) expect(existsSync(join(out, address)), address).toBe(true)
    // The catalog page shows the grid only: the other formats of a game the library does not hold are dropped.
    for (const address of OTHER.grid) expect(existsSync(join(out, address)), address).toBe(true)
    for (const address of [...OTHER.hero, ...OTHER.icon]) expect(existsSync(join(out, address)), address).toBe(false)
    // An answer that is not a game's or the catalog's names a picture too: it is kept.
    expect(existsSync(join(out, AVATAR))).toBe(true)
  })

  it('fails the build when an answer names a picture the output lacks', async () => {
    const out = await output('missing')
    const [gone] = artNamed(snapshotOf(out))
    rmSync(join(out, gone!))
    expect(() => checkArt(out)).toThrow(gone!)
  })

  it('fails the build when a game page names a picture the output lacks', async () => {
    const out = await output('page')
    const page = join(out, 'g/the-question/b1/index.html')
    writeFileSync(page, readFileSync(page, 'utf8') + '<img src="/api/art/0123456789abcdef.webp">')
    expect(() => checkArt(out)).toThrow('/api/art/0123456789abcdef.webp')
  })

  it('names the pictures of any format, once each', () => {
    expect(artNamed('"/api/art/a1.webp" "/api/art/a1.webp" /api/art/b2.png?x', 'url(/api/art/c-3.avif)')).toEqual(['/api/art/a1.webp', '/api/art/b2.png', '/api/art/c-3.avif'])
  })
})
