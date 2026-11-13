import { expect, it, vi } from 'vitest'
import { htmlRuntime } from './runtime-browser.js'

// RPG Maker MZ keeps every image until the player changes maps: the runtime keeps the ones shown
// within a budget (192 MB on a phone, 768 MB elsewhere), without destroying any.

/** A small RPG Maker MZ: its image cache, sprites that show bitmaps, and a clock. */
function game(name: 'MZ' | 'MV', phone: boolean) {
  const clock = { now: 0 }
  // PIXI's frame count: it marks each texture it draws.
  const gc = { count: 1 }
  const made: any[] = []
  // A picture of 2048 x 1024 is 8 MB once shown.
  class Bitmap {
    _baseTexture = { touched: 0 }
    destroy = vi.fn()
    constructor(public url: string, public width = 2048, public height = 1024) { made.push(this) }
    isReady() { return true }
  }
  class Sprite {
    _bitmap: Bitmap | null = null
    _onBitmapLoad(_bitmap: Bitmap) {}
  }
  class TilingSprite {
    _bitmap: Bitmap | null = null
    _onBitmapLoad() {}
  }
  const manager: any = {
    _cache: {} as Record<string, Bitmap>,
    _system: {} as Record<string, Bitmap>,
    loadBitmapFromUrl(url: string) {
      const cache = url.includes('/system/') ? this._system : this._cache
      cache[url] ??= new Bitmap(url)
      return cache[url]
    },
  }
  const page = htmlRuntime(1, (w) => {
    if (phone) w.matchMedia = (query: string) => ({ matches: query === '(pointer: coarse)' })
    w.performance = { now: () => clock.now }
    w.Utils = { RPGMAKER_NAME: name, isNwjs: () => false }
    w.Sprite = Sprite
    w.TilingSprite = TilingSprite
    w.ImageManager = manager
    w.Graphics = { app: { renderer: { textureGC: gc } } }
  })
  page.fire('load')
  const load = (url: string) => page.window.ImageManager.loadBitmapFromUrl(url)
  /** A sprite shows the bitmap, the way MZ does once it has loaded. */
  const show = (bitmap: Bitmap) => { const s = new Sprite(); s._bitmap = bitmap; s._onBitmapLoad(bitmap) }
  const wait = (seconds: number) => { clock.now += seconds * 1000; gc.count += seconds * 60 }
  /** PIXI draws the bitmap in this frame. */
  const draw = (bitmap: Bitmap) => { bitmap._baseTexture.touched = gc.count }
  // What the shown pictures in the cache weigh. The cache is trimmed when the game asks for an
  // image: it holds the budget and at most the picture shown last.
  const shownMB = () => Object.values(manager._cache).filter((b: any) => shownOnce.has(b)).length * 8
  const shownOnce = new Set<Bitmap>()
  const showAndKeep = (bitmap: Bitmap) => { shownOnce.add(bitmap); show(bitmap) }
  return { page, manager, made, load, show: showAndKeep, wait, draw, shownMB, TilingSprite }
}

it('keeps the pictures a phone has shown within its budget, letting the oldest go', () => {
  const g = game('MZ', true)
  // Thirty pictures shown one after another, five seconds each: 240 MB in all.
  const shown = []
  for (let i = 0; i < 30; i++) {
    const bitmap = g.load(`img/pictures/scene${i}.png`)
    g.show(bitmap)
    g.wait(5)
    shown.push(bitmap)
  }
  expect(g.shownMB()).toBeLessThanOrEqual(192 + 8)
  expect(g.manager._cache['img/pictures/scene0.png']).toBeUndefined()
  expect(g.manager._cache['img/pictures/scene29.png']).toBe(shown[29])
  // None is destroyed: a sprite that still holds one keeps a working picture.
  expect(g.made.some((b) => b.destroy.mock.calls.length)).toBe(false)
  // Asked for again, a picture that left loads again.
  const again = g.load('img/pictures/scene0.png')
  expect(again).not.toBe(shown[0])
  expect(g.manager._cache['img/pictures/scene0.png']).toBe(again)
})

it('keeps what was shown or asked for in the last seconds, and what was only preloaded', () => {
  const g = game('MZ', true)
  // An event preloads forty pictures at its start: never shown, they all stay.
  const preloaded = Array.from({ length: 40 }, (_, i) => g.load(`img/pictures/event${i}.png`))
  // Thirty pictures shown together, just now: past the budget, and none goes.
  const together = Array.from({ length: 30 }, (_, i) => g.load(`img/pictures/layer${i}.png`))
  together.forEach(g.show)
  g.wait(1)
  g.load('img/pictures/one-more.png')
  expect(together.every((b) => g.manager._cache[b.url] === b)).toBe(true)
  expect(preloaded.every((b) => g.manager._cache[b.url] === b)).toBe(true)
  // Later, the preloaded pictures are shown in turn: the layers, shown longest ago, make room.
  g.wait(10)
  for (const b of preloaded.slice(0, 20)) {
    g.show(g.load(b.url))
    g.wait(4)
  }
  expect(g.manager._cache['img/pictures/layer0.png']).toBeUndefined()
  expect(preloaded.slice(0, 20).slice(-5).every((b) => g.manager._cache[b.url] === b)).toBe(true)
  expect(g.shownMB()).toBeLessThanOrEqual(192 + 8)
})

it('keeps an image that stays on screen, however long ago it was first shown', () => {
  const g = game('MZ', true)
  // A character sheet, shown at the start and drawn every frame since.
  const sheet = g.load('img/characters/People1.png')
  g.show(sheet)
  for (let i = 0; i < 30; i++) {
    g.show(g.load(`img/pictures/scene${i}.png`))
    g.wait(5)
    g.draw(sheet)
  }
  expect(g.manager._cache['img/characters/People1.png']).toBe(sheet)
  expect(g.manager._cache['img/pictures/scene0.png']).toBeUndefined()
  expect(g.shownMB()).toBeLessThanOrEqual(192 + 8)
})

it('counts a parallax shown by a tiling sprite', () => {
  const g = game('MZ', true)
  const parallax = g.load('img/parallaxes/sky.png')
  const sprite = new g.TilingSprite()
  sprite._bitmap = parallax
  sprite._onBitmapLoad()
  g.wait(5)
  for (let i = 0; i < 30; i++) {
    g.show(g.load(`img/pictures/scene${i}.png`))
    g.wait(5)
  }
  expect(g.manager._cache['img/parallaxes/sky.png']).toBeUndefined()
})

it('uses a larger budget on a computer, and leaves RPG Maker\'s system images alone', () => {
  const g = game('MZ', false)
  const window = g.load('img/system/Window.png')
  g.show(window)
  for (let i = 0; i < 120; i++) {
    g.show(g.load(`img/pictures/scene${i}.png`))
    g.wait(5)
  }
  expect(g.shownMB()).toBeGreaterThan(192 + 8)
  expect(g.shownMB()).toBeLessThanOrEqual(768 + 8)
  expect(g.manager._system['img/system/Window.png']).toBe(window)
})

it('still sees every image after a plugin replaces how images load', () => {
  const g = game('MZ', true)
  const ours = g.manager.loadBitmapFromUrl
  const plugin = vi.fn((url: string) => ours.call(g.manager, url))
  g.manager.loadBitmapFromUrl = (url: string) => plugin(url)
  g.page.fire('load')
  for (let i = 0; i < 40; i++) {
    g.show(g.load(`img/pictures/scene${i}.png`))
    g.wait(5)
  }
  expect(plugin).toHaveBeenCalledTimes(40)
  expect(g.shownMB()).toBeLessThanOrEqual(192 + 8)
})

it('leaves RPG Maker MV, which limits its own cache, as it is', () => {
  const g = game('MV', true)
  for (let i = 0; i < 40; i++) {
    g.show(g.load(`img/pictures/scene${i}.png`))
    g.wait(5)
  }
  expect(g.shownMB()).toBe(320)
})
