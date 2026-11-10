import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'

/** A game page's window in a frame, with just enough of the browser for the shared part. */
function page(stored: Record<string, string> = {}) {
  const listeners: Record<string, Array<(e: unknown) => void>> = {}
  const sent: Array<Record<string, unknown>> = []
  const parent = { postMessage: (msg: Record<string, unknown>) => sent.push(msg) }
  class AudioNode {
    connected: unknown[] = []
    connect(target: unknown) { this.connected.push(target); return target }
    disconnect() {}
  }
  class AudioDestinationNode extends AudioNode {
    context = { createGain: () => Object.assign(new AudioNode(), { gain: { value: -1 } }) }
  }
  const window: Record<string, unknown> = {
    __renplay: {}, parent, location: { origin: 'http://renplay.test' },
    localStorage: { getItem: (k: string) => stored[k] ?? null },
    addEventListener: (type: string, f: (e: unknown) => void) => (listeners[type] ??= []).push(f),
    AudioNode, AudioDestinationNode, Map,
  }
  window.window = window
  const fire = (type: string, e: Record<string, unknown>) => (listeners[type] ?? []).forEach((f) => f(e))
  return { window, sent, fire, AudioNode, AudioDestinationNode }
}

describe('the runtime both kinds of game share', () => {
  it('is served with Ren\'Py\'s runtime in one function: nothing global, Esc only in fullscreen, muted from the stored choice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'renplay-runtime-'))
    process.env['DATA_DIR'] = join(root, 'data')
    process.env['GAMES_DIR'] = join(root, 'games')
    const app = await createApp(loadConfig(), { startJobs: false })
    try {
      const res = await request(app.app).get('/renplay/runtime.js').expect(200)
      expect(res.headers['content-type']).toMatch(/javascript/)
      expect(res.headers['cache-control']).toContain('immutable')

      const p = page({ 'renplay:muted': '1' })
      runInNewContext(res.text, p.window)
      runInNewContext(res.text, p.window)
      expect(Object.keys(p.window).filter((k) => /^(post|cfg|muted|setAudioMuted|isMuted)$/.test(k))).toEqual([])

      p.fire('keydown', { key: 'Escape', repeat: false })
      expect(p.sent).toEqual([])
      p.fire('message', { source: p.window.parent, data: { type: 'renplay:fullscreen-state', value: true } })
      p.fire('keydown', { key: 'Escape', repeat: false })
      // Loaded twice, it still reports once.
      expect(p.sent).toEqual([{ type: 'renplay:escape', down: true, game: undefined, userId: undefined }])

      const source = new p.AudioNode(), out = new p.AudioDestinationNode()
      source.connect(out)
      const gain = source.connected[0] as InstanceType<typeof p.AudioNode> & { gain: { value: number } }
      expect(gain.gain.value).toBe(0)
      expect(gain.connected).toEqual([out])
    } finally {
      app.close()
    }
  })

  it('measures the frame rate once, half a minute after the game is ready, for the usage report', () => {
    const source = readFileSync(new URL('../../../runtime/renplay-player.js', import.meta.url), 'utf-8')
    /** A page whose browser draws a frame every `every` milliseconds. */
    const measure = (every: number, visibility: () => string = () => 'visible') => {
      const p = page()
      const timers: Array<{ at: number; run: () => void }> = []
      const frames: Array<(now: number) => void> = []
      let now = 0
      Object.assign(p.window, {
        document: { get visibilityState() { return visibility() } },
        setTimeout: (run: () => void, ms: number) => timers.push({ at: now + ms, run }),
        requestAnimationFrame: (run: (t: number) => void) => frames.push(run),
      })
      runInNewContext(`(function () { ${source}\n post('ready'); post('ready') })()`, p.window)
      // Nothing is measured before the half minute is over.
      for (const t of timers.splice(0).filter((t) => t.at <= 30_000)) t.run()
      while (frames.length && now < 40_000) {
        const frame = frames.shift()!
        now += every
        frame(now)
      }
      return p.sent.filter((m) => m['type'] === 'renplay:perf')
    }
    expect(measure(1000 / 60)).toEqual([{ type: 'renplay:perf', fps: 60, game: undefined, userId: undefined }])
    expect(measure(1000 / 24)).toEqual([{ type: 'renplay:perf', fps: 24, game: undefined, userId: undefined }])
    // A page nobody sees is not measured.
    expect(measure(1000 / 60, () => 'hidden')).toEqual([])
  })
})
