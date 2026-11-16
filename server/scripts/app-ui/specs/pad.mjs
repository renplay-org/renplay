/** A simulated controller for the library and the player: the page reads `navigator.getGamepads()` on every frame. */
export const padScript = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
  const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 }
  navigator.getGamepads = () => [pad]
  const names = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, menu: 9, up: 12, down: 13, left: 14, right: 15 }
  /** `__hold(button, on)` presses a button, 'down' and the like for the d-pad. */
  window.__hold = (name, on) => { buttons[names[name]].pressed = on }
  /** `__stick(x, y, rx, ry)` puts the sticks where they are: -1 to 1, up and left negative. */
  window.__stick = (x = 0, y = 0, rx = 0, ry = 0) => { pad.axes[0] = x; pad.axes[1] = y; pad.axes[2] = rx; pad.axes[3] = ry }
  window.dispatchEvent(new Event('gamepadconnected'))
}

/** Gives the page a controller, before it loads. */
export const withPad = (page) => page.addInitScript(padScript)

/** Presses a button for `ms`, then lets go and waits a little for the page to see it. */
export const tap = (page, name, ms = 100) => page.evaluate(([n, t]) => new Promise((done) => { window.__hold(n, true); setTimeout(() => { window.__hold(n, false); setTimeout(done, 100) }, t) }), [name, ms])

/**
 * Puts the stick through these positions, one every 16 ms (a frame at 60 Hz), then lets it go. By the clock, not by
 * the page's frames: a slow machine draws fewer frames, and the stick must still be held as long as the test says.
 */
export const feed = (page, frames) => page.evaluate((list) => new Promise((done) => {
  let i = 0
  const step = () => {
    if (i >= list.length) { window.__stick(0, 0, 0, 0); return setTimeout(done, 100) }
    window.__stick(...list[i++])
    setTimeout(step, 16)
  }
  step()
}), frames)

/** Counts every focus change from here on: `moves` says how many and to what. */
export const watchFocus = (page) => page.evaluate(() => {
  window.__focus = []
  document.addEventListener('focusin', (e) => window.__focus.push(e.target.getAttribute('data-id') ?? e.target.getAttribute('aria-label') ?? e.target.textContent.trim().slice(0, 30)))
})
export const moves = (page) => page.evaluate(() => window.__focus.slice())
