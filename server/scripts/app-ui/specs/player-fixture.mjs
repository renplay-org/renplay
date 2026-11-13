import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { mock } from '../../app-mock.mjs'
import { pdf } from '../pdf.mjs'
import { expect } from './fixtures.mjs'

// The in-game view with a made-up game page: the real shared runtime part (runtime/renplay-player.js, which
// catches the keys) and a small stand-in for the engine that answers the player's messages. What it was sent
// is kept in window.__frameMsgs of the player page.
const sharedRuntime = readFileSync(new URL('../../../../runtime/renplay-player.js', import.meta.url), 'utf8')
export const GAME = 'game-000'
const gamePage = `<!doctype html><html><body tabindex="0" style="margin:0;background:#222"><script>
;(function () {
  window.__renplay = { id: '${GAME}', userId: 1 }
  ${sharedRuntime}
  var log = (parent.__frameMsgs = parent.__frameMsgs || [])
  window.addEventListener('message', function (e) {
    var d = e.data
    if (!d || typeof d.type !== 'string') return
    log.push(d)
    // The engine's own page takes the keyboard when the player gives it back.
    if (d.type === 'renplay:focus') window.focus()
    if (d.type === 'renplay:save-now') window.__saved().then(function () { post('saved-now', { id: d.id, saved: true, ok: true }) })
    if (d.type === 'renplay:save-and-load') post('loaded', { id: d.id, ok: true, saved: true })
    if (d.type === 'renplay:options') post('options', { ok: true, patches: {}, fontSize: 1, patchesFrom: 'default', sizeFrom: 'default' })
  })
  // The runtime tells the player when the server cannot be reached.
  window.addEventListener('offline', function () { post('sync', { pending: 1, online: false, lastSync: 0 }) })
  post('ready')
})()
</script></body></html>`

export const slot = (n, minutes) => ({ file: `quick-${n}-LT1.save`, size: 1, mtime: 0, kind: 'quick', label: `Quick ${n}`, name: 'Diya', ctime: Date.parse('2026-11-11T12:00:00Z') - minutes * 60_000, screenshot: null, valid: true, title: null, note: null, pinnedAt: null })

const file = (name, title, kind) => ({ file: name, title, kind, size: 1, addedAt: '2026-11-01T00:00:00Z', url: `/api/walkthroughs/${name}` })
/** The guide files a game can have: a tall picture, a three page PDF and a text file. */
export const GUIDE = file('guide.png', 'Guide', 'image')
export const PDF = file('guide.pdf', 'Walkthrough', 'pdf')
export const TEXT = file('notes.txt', 'Notes', 'text')

/** A controller: the player reads `window.__pad`. `__hold(button, on)` presses a button, 'dpad-down' and the like included. */
const padScript = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
  const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 }
  navigator.getGamepads = () => [pad]
  const names = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, menu: 9, up: 12, down: 13, left: 14, right: 15 }
  window.__hold = (name, on) => { buttons[names[name]].pressed = on }
  window.dispatchEvent(new Event('gamepadconnected'))
}

/** Opens the game with its saves, and what the made-up engine saw. */
export async function play(page, { slots = [slot(2, 30), slot(3, 60)], iphone = false, walkthroughs = [GUIDE], pad = false } = {}) {
  if (pad) await page.addInitScript(padScript)
  // Safari on an iPhone: no Fullscreen API, so the menu has the home screen row and the first game shows the tip.
  if (iphone)
    await page.addInitScript(() => {
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => false })
      Object.defineProperty(Navigator.prototype, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' })
    })
  await page.addInitScript(() => {
    // Chromium's Keyboard Lock and layout map, which the test browser does not grant.
    Object.defineProperty(Navigator.prototype, 'keyboard', { configurable: true, get: () => ({ lock: async () => {}, unlock() {}, getLayoutMap: async () => new Map([['Backquote', '`'], ['Backslash', '\\']]) }) })
  })
  // The game has a guide, so the Guide row and the backslash key are there. Asked again, the mock answers with the patch.
  await mock(page, [], 'player', { titled: true, patch: { [GAME]: { walkthroughs } } })
  // A popup window the page opens gets the same answers and the same files.
  await mock(page, [], 'player', { titled: true, patch: { [GAME]: { walkthroughs } }, shared: true })
  const picture = await sharp({ create: { width: 1000, height: 1400, channels: 3, background: '#5a6' } }).png().toBuffer()
  const text = Array.from({ length: 120 }, (_, i) => `Line ${i + 1}: talk to Diya, then Min-seo, and pick the second option.`).join('\n')
  const files = (route) => {
    const name = new URL(route.request().url()).pathname
    if (name.endsWith('.pdf')) return route.fulfill({ status: 200, contentType: 'application/pdf', body: pdf(3, 40) })
    if (name.endsWith('.txt')) return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: text })
    return route.fulfill({ status: 200, contentType: 'image/png', body: picture })
  }
  await page.context().route('**/api/walkthroughs/*', files)
  await page.route('**/api/walkthroughs/*', files)
  const list = [...slots]
  await page.exposeFunction('__saved', () => { list.unshift(slot(1, 0)) })
  await page.route(`**/api/saves/${GAME}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ saveDir: 'save-0', slots: list, other: [], conflicts: [], sync: false }) }))
  await page.route(`**/g/${GAME}/b1/**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: gamePage }))
  await page.goto(`/play/${GAME}`)
  // A phone held upright is asked to turn: it plays upright anyway.
  const { width, height } = page.viewportSize()
  if (height > width) await page.getByRole('button', { name: 'Play upright anyway' }).click()
  await expect(page.locator('.rp-pill').first()).toBeVisible()
  return { sent: (type) => page.evaluate((t) => (window.__frameMsgs ?? []).filter((m) => m.type === t), type) }
}

