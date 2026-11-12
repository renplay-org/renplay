import { expect, it } from 'vitest'
import { htmlRuntime } from './runtime-browser.js'

// The game's frame has an opaque origin: its own files count as another origin's.
it('loads a game\'s pictures so its canvas can be read back', () => {
  class HTMLImageElement {
    crossOrigin: string | null = null
    private url = ''
    get src() { return this.url }
    set src(value: string) { this.url = value }
  }
  const { window } = htmlRuntime(1, (w) => { w.HTMLImageElement = HTMLImageElement })
  const skin = new window.HTMLImageElement()
  skin.src = 'img/system/Window.png'
  expect([skin.src, skin.crossOrigin]).toEqual(['img/system/Window.png', 'anonymous'])
  // The game's own choice stays, and pictures made in the page need nothing.
  const chosen = new window.HTMLImageElement()
  chosen.crossOrigin = 'use-credentials'
  chosen.src = 'img/a.png'
  const drawn = new window.HTMLImageElement()
  drawn.src = 'data:image/png;base64,AAAA'
  // Another site may send no CORS headers: its pictures load as before.
  const elsewhere = new window.HTMLImageElement()
  elsewhere.src = 'https://cdn.example/banner.png'
  expect([chosen.crossOrigin, drawn.crossOrigin, elsewhere.crossOrigin]).toEqual(['use-credentials', null, null])
})

it('starts a game\'s worker from a copy of its script, which still finds the game\'s files', () => {
  const started: string[] = []
  let sends = 0
  const blobs = new Map<string, Blob>()
  class Worker {
    constructor(public url: string) {
      if (!url.startsWith('blob:')) throw new DOMException(`Script at '${url}' cannot be accessed from origin 'null'.`, 'SecurityError')
      started.push(url)
    }
  }
  class XMLHttpRequest {
    status = 0
    responseText = ''
    private url = ''
    open(_method: string, url: string, async: boolean) { expect(async).toBe(false); this.url = url }
    send() {
      expect(this.url).toBe('http://renplay.test/g/game/b1/js/libs/vorbisdecoder.js')
      sends++
      this.status = 200
      this.responseText = 'self.decoder = true'
    }
  }
  const { window } = htmlRuntime(1, (w) => {
    w.Worker = Worker
    w.XMLHttpRequest = XMLHttpRequest
    w.URL = Object.assign(class extends URL {}, { createObjectURL: (blob: Blob) => { const id = `blob:null/${blobs.size}`; blobs.set(id, blob); return id } })
  })
  const worker = new window.Worker('js/libs/vorbisdecoder.js')
  expect(worker).toBeInstanceOf(Worker)
  // A sound per worker: the next one starts from the same copy, without asking again.
  new window.Worker('js/libs/vorbisdecoder.js')
  expect(started).toEqual(['blob:null/0', 'blob:null/0'])
  expect(() => new window.Worker('https://cdn.example/other.js')).toThrow('cannot be accessed')
  expect(sends).toBe(1)
  return blobs.get('blob:null/0')!.text().then((code) => {
    expect(code.endsWith('self.decoder = true')).toBe(true)
    // In the copy, relative addresses (importScripts, fetch) mean the script's folder.
    const self: any = { importScripts: (...urls: string[]) => urls, fetch: (url: string) => url }
    new Function('self', code.split('\n')[0]!)(self)
    expect(self.importScripts('decoder.wasm.js')).toEqual(['http://renplay.test/g/game/b1/js/libs/decoder.wasm.js'])
    expect(self.fetch('vorbisdecoder.wasm')).toBe('http://renplay.test/g/game/b1/js/libs/vorbisdecoder.wasm')
  })
})

it('loads media for Web Audio, set as a property or with setAttribute', () => {
  class Element {
    tagName = ''
    crossOrigin: string | null = null
    attrs: Record<string, string> = {}
    setAttribute(name: string, value: string) { this.attrs[name] = value }
  }
  class HTMLMediaElement extends Element {
    private url = ''
    get src() { return this.url }
    set src(value: string) { this.url = value }
  }
  const { window } = htmlRuntime(1, (w) => { Object.assign(w, { Element, HTMLMediaElement }) })
  const music = new window.HTMLMediaElement()
  music.src = 'audio/bgm/theme.ogg'
  const video = new window.Element()
  video.tagName = 'VIDEO'
  video.setAttribute('src', 'movies/opening.webm')
  expect([music.crossOrigin, video.crossOrigin, video.attrs['src']]).toEqual(['anonymous', 'anonymous', 'movies/opening.webm'])
})

it('answers no gamepads when the browser refuses the frame, instead of stopping the game', () => {
  const pads = [{ id: 'pad' }]
  let refuse = true
  const { window } = htmlRuntime(1, (w) => {
    w.navigator = { getGamepads: () => { if (refuse) throw new DOMException('frames are not allowed to call getGamepads()', 'SecurityError'); return pads } }
  })
  expect(window.navigator.getGamepads()).toEqual([])
  refuse = false
  expect(window.navigator.getGamepads()).toBe(pads)
})

it('lets RPG Maker on a phone use the frame\'s whole height', () => {
  const updated: string[] = []
  const Graphics = {
    _canvas: {},
    // RPG Maker's own: in a phone's browser a tenth is kept for the browser's bars.
    _stretchHeight: () => 390 * 0.9,
    _updateRealScale() { updated.push(`scale for ${this._stretchHeight()}`) },
    _updateAllElements() { updated.push('elements') },
  }
  const page = htmlRuntime(1, (w) => {
    w.document.documentElement = { clientHeight: 390 }
    w.document.getElementsByTagName = () => []
    Object.assign(w, { Graphics, Utils: { RPGMAKER_NAME: 'MZ' } })
  })
  page.fire('load')
  expect(page.window.Graphics._stretchHeight()).toBe(390)
  expect(updated).toEqual(['scale for 390', 'elements'])
})
