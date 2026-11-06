import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtStore, catalogPictures, keeps, planFormat, type CatalogImage, type Picture } from '../art.js'
import type { Config } from '../config.js'
import { Db } from '../db.js'

const png = (width: number, height: number, background = '#3a6ea5', alpha = false) =>
  sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 200, g: 80, b: 60, alpha: 0.6 } : background } }).png().toBuffer()
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const pic = (kind: Picture['kind'], width: number, height: number, extra: Partial<Picture> = {}): Picture => ({
  id: `${kind}-${width}x${height}`, kind, url: `https://art.example/${kind}.png`, width, height, thumbhash: null, tint: null,
  focal: null, dark: false, sha256: null, source: 'steam', credit: { store: 'Steam' }, upload: false, default: true, ...extra,
})

describe('the making order', () => {
  it('uses real art in the shape, within 2 percent', () => {
    expect(planFormat('grid', { grid: pic('grid', 600, 900) })?.mode).toBe('resize')
    expect(planFormat('grid', { grid: pic('grid', 1200, 1800) })?.mode).toBe('resize')
    expect(planFormat('wide', { wide: pic('wide', 460, 215) })?.mode).toBe('resize')
    expect(planFormat('logo', { logo: pic('logo', 640, 360) })?.mode).toBe('resize')
    expect(planFormat('logo', { grid: pic('grid', 600, 900) })).toBeNull()
  })

  it('crops when the crop keeps 60 percent, and always when a focal point is given', () => {
    // A hero from a 920x430 wide keeps 69 percent: a crop.
    expect(keeps('hero', { width: 920, height: 430 })).toBeGreaterThan(0.6)
    expect(planFormat('hero', { wide: pic('wide', 920, 430) })?.mode).toBe('crop')
    // A grid from an itch.io cover (630x500) keeps 53 percent: whole on its glow.
    expect(keeps('grid', { width: 630, height: 500 })).toBeLessThan(0.6)
    expect(planFormat('grid', { grid: pic('grid', 630, 500) })?.mode).toBe('whole')
    // A contributor's focal point always forces the crop.
    expect(planFormat('grid', { grid: pic('grid', 630, 500, { focal: [0.3, 0.5] }) })?.mode).toBe('crop')
  })

  it('composes a wide from a poster and a grid from a wide picture, and makes a hero glow', () => {
    expect(planFormat('wide', { grid: pic('grid', 600, 900) })?.mode).toBe('poster')
    expect(planFormat('grid', { wide: pic('wide', 920, 430) })?.mode).toBe('across')
    expect(planFormat('hero', { grid: pic('grid', 600, 900) })?.mode).toBe('glow')
    // A lone squarish picture neither crops nor composes: whole on its glow.
    expect(planFormat('wide', { grid: pic('grid', 630, 500) })?.mode).toBe('whole')
  })

  it('cuts the icon from the grid unless one is supplied', () => {
    expect(planFormat('icon', { grid: pic('grid', 600, 900) })).toMatchObject({ mode: 'cut', source: { kind: 'grid' } })
    expect(planFormat('icon', { icon: pic('icon', 512, 512), grid: pic('grid', 600, 900) })?.mode).toBe('resize')
    expect(planFormat('icon', {})).toBeNull()
  })

  it('makes a format from the best other picture: the one a crop keeps most of', () => {
    const plan = planFormat('hero', { grid: pic('grid', 600, 900), wide: pic('wide', 920, 430) })
    expect(plan).toMatchObject({ mode: 'crop', source: { kind: 'wide' } })
  })
})

describe('the art cache', () => {
  let root = ''
  let db: Db
  let level: 'off' | 'blurred' | 'shown' = 'shown'
  let fetched: string[] = []
  let files: Record<string, Buffer> = {}
  const store = () => new ArtStore({ dataDir: join(root, 'data'), imageConcurrency: 2 } as Config, db, { get level() { return level }, viewerLevel: () => level } as never)

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'renplay-art-'))
    db = Db.open(join(root, 'data'))
    level = 'shown'
    fetched = []
    files = {}
    vi.stubGlobal('fetch', async (url: URL | string) => {
      const u = String(url)
      fetched.push(u)
      const body = files[u]
      if (!body) return new Response('missing', { status: 404 })
      return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } })
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  const catalog = async (images: Array<Omit<CatalogImage, 'sha256' | 'width' | 'height'> & { data: Buffer }>) => {
    const out: CatalogImage[] = []
    for (const { data, ...img } of images) {
      files[img.url] = data
      const m = await sharp(data).metadata()
      out.push({ ...img, sha256: sha(data), width: m.width, height: m.height })
    }
    return catalogPictures(out)
  }

  it('makes every format at its size, 2x only from enough detail, with hashes and tints', async () => {
    const pictures = await catalog([
      { kind: 'grid', url: 'https://art.example/grid.png', source: 'sgdb', by: 'Someone', byUrl: 'https://www.steamgriddb.com/profile/1', asset: 'https://www.steamgriddb.com/grid/1', data: await png(1200, 1800) },
      { kind: 'logo', url: 'https://art.example/logo.png', source: 'steam', data: await png(800, 300, '', true) },
    ])
    const art = store()
    const subject = { game: null, adult: false, pictures }
    await art.ready(subject, 0)
    const set = art.forSubject(subject, { scope: 0, blurred: false }) as Record<string, { url1x: string; url2x: string; width: number; height: number; made: string | null; thumbhash: string; tint: string; credit: unknown }>
    expect(set['grid']).toMatchObject({ width: 600, height: 900, made: null, credit: { by: 'Someone', asset: 'https://www.steamgriddb.com/grid/1' } })
    expect(set['grid']!.url2x).not.toBe(set['grid']!.url1x)
    expect(set['wide']).toMatchObject({ width: 920, height: 430, made: 'composed' })
    expect(set['hero']).toMatchObject({ width: 1920, height: 620, made: 'glow' })
    expect(set['hero']!.url2x).toBe(set['hero']!.url1x)
    expect(set['icon']).toMatchObject({ width: 512, height: 512, made: 'crop' })
    expect(set['logo']).toMatchObject({ width: 640, made: null })
    for (const f of Object.values(set)) {
      expect(f.thumbhash).toMatch(/^[A-Za-z0-9+/=]{10,}$/)
      expect(f.tint).toMatch(/^#[0-9a-f]{6}$/)
      const file = join(root, 'data', 'art', f.url1x.split('/').pop()!)
      const meta = await sharp(file).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', f.width, f.height])
    }
    // Each original is downloaded once, however many formats it makes.
    expect(fetched.filter((u) => u.endsWith('grid.png'))).toHaveLength(1)
    expect((await sharp(join(root, 'data', 'art', set['logo']!.url1x.split('/').pop()!)).metadata()).hasAlpha).toBe(true)
  })

  it('notices a logo of dark lettering, so it can be inverted on ink', async () => {
    const lettering = (r: number) => sharp({ create: { width: 400, height: 150, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(`<svg width="400" height="150"><rect x="20" y="40" width="360" height="70" fill="rgb(${r},${r},${r})"/></svg>`) }]).png().toBuffer()
    const dark = await catalog([{ kind: 'logo', url: 'https://art.example/dark.png', source: 'steam', data: await lettering(30) }])
    const light = await catalog([{ kind: 'logo', url: 'https://art.example/light.png', source: 'steam', data: await lettering(240) }])
    const art = store()
    for (const pictures of [dark, light]) await art.ready({ game: null, adult: false, pictures }, 0)
    expect(art.forSubject({ game: null, adult: false, pictures: dark }, { scope: 0, blurred: false })['logo']).toMatchObject({ dark: true })
    expect(art.forSubject({ game: null, adult: false, pictures: light }, { scope: 0, blurred: false })['logo']).not.toHaveProperty('dark')
  })

  it('refuses a picture that changed since the catalog checked it', async () => {
    const pictures = await catalog([{ kind: 'grid', url: 'https://art.example/grid.png', source: 'steam', data: await png(600, 900) }])
    files['https://art.example/grid.png'] = await png(600, 900, '#ff0000')
    const art = store()
    const plan = planFormat('grid', { grid: pictures[0]! })!
    await expect(art.ensure(plan, false)).rejects.toThrow(/changed since the catalog checked it/)
    expect(existsSync(join(root, 'data', 'art'))).toBe(readdirSync(join(root, 'data')).includes('art'))
  })

  it('never downloads an adult game\'s pictures below Shown, and sends only hashes and tints', async () => {
    const pictures = await catalog([{ kind: 'grid', url: 'https://art.example/adult.png', source: 'sgdb', thumbhash: 'AAAA', tint: '#123456', data: await png(600, 900) }])
    const subject = { game: null, adult: true, pictures }
    for (const at of ['off', 'blurred'] as const) {
      level = at
      const art = store()
      await art.ready(subject, 0)
      expect(art.forSubject(subject, { scope: 0 })).toEqual({ grid: { thumbhash: 'AAAA', tint: '#123456' }, wide: { thumbhash: 'AAAA', tint: '#123456' }, hero: { thumbhash: 'AAAA', tint: '#123456' }, icon: { thumbhash: 'AAAA', tint: '#123456' } })
      expect(await art.sync([subject])).toEqual([])
    }
    expect(fetched).toEqual([])
    // At Shown it is made, and its files are for people at Shown only.
    level = 'shown'
    const art = store()
    await art.ready(subject, 0)
    const url = (art.forSubject(subject, { scope: 0 }) as Record<string, { url1x: string }>)['grid']!.url1x
    const file = url.split('/').pop()!
    expect(art.canRead(file)).toBe(true)
    level = 'blurred'
    expect(art.canRead(file)).toBe(false)
  })

  it('follows the person\'s choice, then the admin\'s for everyone, then the catalog default', async () => {
    const pictures = await catalog([
      { kind: 'grid', url: 'https://art.example/a.png', source: 'steam', default: true, data: await png(600, 900, '#aa0000') },
      { kind: 'grid', url: 'https://art.example/b.png', source: 'sgdb', by: 'B', data: await png(600, 900, '#00aa00') },
      { kind: 'grid', url: 'https://art.example/c.png', source: 'sgdb', by: 'C', data: await png(600, 900, '#0000aa') },
    ])
    const art = store()
    const subject = { game: 'g', adult: false, pictures }
    const grid = (scope: number) => art.chosen(subject, scope).grid!.url
    expect(grid(5)).toBe('https://art.example/a.png')
    art.choose('g', 'grid', pictures[1]!.id, 0)
    expect(grid(5)).toBe('https://art.example/b.png')
    art.choose('g', 'grid', pictures[2]!.id, 5)
    expect(grid(5)).toBe('https://art.example/c.png')
    expect(grid(6)).toBe('https://art.example/b.png')
    art.clearChoice('g', 'grid', 5)
    expect(grid(5)).toBe('https://art.example/b.png')
    // The candidates say which one an admin chose for everyone, and which this person chose.
    art.choose('g', 'grid', pictures[2]!.id, 5)
    const flags = (await art.candidates(subject, 'grid', 5)).map((c) => [c.everyone, c.mine, c.current])
    expect(flags).toEqual([[false, false, false], [true, false, false], [false, true, true]])
    art.clearChoice('g', 'grid', 0)
    expect((await art.candidates(subject, 'grid', 5)).some((c) => c.everyone)).toBe(false)
    art.clearChoice('g', 'grid', 5)
    art.choose('g', 'grid', pictures[1]!.id, 0)
    // A choice of a picture the catalog no longer has falls back to the default.
    art.choose('g', 'grid', 'gone', 0)
    expect(grid(5)).toBe('https://art.example/a.png')
  })

  it('accepts an upload of another size with a warning and places it with the focal point crop', async () => {
    const art = store()
    const { id, warning } = await art.upload('g', 'grid', await png(1000, 1000), [0.2, 0.5], 7)
    expect(warning).toEqual({ width: 1000, height: 1000 })
    art.choose('g', 'grid', id, 7)
    const subject = { game: 'g', adult: false, pictures: art.uploads('g', 7) }
    expect(art.uploads('g', 8)).toEqual([])
    await art.ready(subject, 7)
    expect(art.forSubject(subject, { scope: 7, blurred: false })['grid']).toMatchObject({ width: 600, height: 900, made: 'crop', credit: { upload: true } })
    expect((await art.upload('g', 'grid', await png(600, 900), null, 7)).warning).toBeNull()
    await expect(art.upload('g', 'logo', await png(400, 200), null, 7)).rejects.toThrow(/transparent/)
    await expect(art.upload('g', 'grid', Buffer.from('not a picture'), null, 7)).rejects.toThrow(/WebP, PNG or JPEG/)
    expect(fetched).toEqual([])
  })

  it('forgets made pictures and originals nothing uses, keeping uploads and fresh work', async () => {
    const pictures = await catalog([
      { kind: 'grid', url: 'https://art.example/a.png', source: 'steam', default: true, data: await png(600, 900, '#aa0000') },
      { kind: 'grid', url: 'https://art.example/b.png', source: 'sgdb', by: 'B', data: await png(600, 900, '#00aa00') },
    ])
    const art = store()
    const subject = { game: 'g', adult: false, pictures }
    art.choose('g', 'grid', pictures[1]!.id, 0)
    await art.sync([subject])
    const made = () => (db.raw.prepare('SELECT COUNT(*) n FROM art_made').get() as { n: number }).n
    const before = made()
    // Back to the default: the next sync, a moment later, forgets what b made.
    art.clearChoice('g', 'grid', 0)
    await new Promise((r) => setTimeout(r, 20))
    await art.sync([subject])
    expect(made()).toBeLessThanOrEqual(before)
    const sources = readdirSync(join(root, 'data', 'art', 'src'))
    expect(sources).toContain(pictures[0]!.id)
    expect(sources).not.toContain(pictures[1]!.id)
    const files = readdirSync(join(root, 'data', 'art')).filter((f) => f.endsWith('.webp'))
    const used = new Set((db.raw.prepare('SELECT file1x, file2x FROM art_made').all() as Array<{ file1x: string; file2x: string }>).flatMap((r) => [r.file1x, r.file2x]))
    expect(files.every((f) => used.has(f))).toBe(true)
  })
})
