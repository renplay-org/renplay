import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** The shared part of the runtimes, run alone with a parent that keeps what it is sent. */
function shared() {
  const source = readFileSync(new URL('../../../runtime/renplay-player.js', import.meta.url), 'utf-8')
  const sent: Array<Record<string, unknown>> = []
  const parent = { postMessage: (msg: Record<string, unknown>) => sent.push(msg) }
  const listeners: Record<string, Array<(e: unknown) => void>> = {}
  const window: Record<string, any> = {
    __renplay: {}, parent, location: { origin: 'http://renplay.test' },
    localStorage: { getItem: () => null },
    addEventListener: (type: string, f: (e: unknown) => void) => (listeners[type] ??= []).push(f),
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (id: Parameters<typeof clearTimeout>[0]) => clearTimeout(id),
    AudioNode: class {}, AudioDestinationNode: class {}, Map,
  }
  window.window = window
  runInNewContext(source, window)
  const guide = () => (listeners['message'] ?? []).forEach((f) => f({ source: parent, data: { type: 'renplay:keys', guide: true } }))
  const kinds = () => sent.map((m) => (m.type === 'renplay:key' ? `key ${m.key}` : String(m.type).replace('renplay:', '')))
  return { window, guide, kinds }
}

describe("the controller's Menu button in a game", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens the menu as it goes down when the game has no guide', () => {
    const page = shared()
    page.window.menuButton(true)
    expect(page.kinds()).toEqual(['menu'])
    page.window.menuButton(false)
    expect(page.kinds()).toEqual(['menu'])
  })

  it('opens the menu when it is let go, and toggles the guide when it is held for half a second', () => {
    const page = shared()
    page.guide()
    // Let go at once: the menu, when the button comes up and not before.
    page.window.menuButton(true)
    vi.advanceTimersByTime(200)
    expect(page.kinds()).toEqual([])
    page.window.menuButton(false)
    expect(page.kinds()).toEqual(['menu'])
    // Held: the guide after half a second, and the release then opens nothing.
    page.window.menuButton(true)
    vi.advanceTimersByTime(499)
    expect(page.kinds()).toEqual(['menu'])
    vi.advanceTimersByTime(2)
    expect(page.kinds()).toEqual(['menu', 'key guide'])
    page.window.menuButton(false)
    expect(page.kinds()).toEqual(['menu', 'key guide'])
  })
})
