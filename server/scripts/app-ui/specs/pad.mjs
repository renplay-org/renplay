/** A simulated controller for the library and the player: the page reads `navigator.getGamepads()` on every frame. */
export const padScript = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }))
  const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 }
  // How many times the page has read the controller: a frame reads it twice in a row, once to see whether one is there and once
  // to see what it holds.
  window.__polls = 0
  navigator.getGamepads = () => { window.__polls++; return [pad] }
  const names = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, menu: 9, up: 12, down: 13, left: 14, right: 15 }
  /** `__hold(button, on)` presses a button, 'down' and the like for the d-pad. */
  window.__hold = (name, on) => { buttons[names[name]].pressed = on }
  /** `__stick(x, y, rx, ry)` puts the sticks where they are: -1 to 1, up and left negative. */
  window.__stick = (x = 0, y = 0, rx = 0, ry = 0) => { pad.axes[0] = x; pad.axes[1] = y; pad.axes[2] = rx; pad.axes[3] = ry }
  /**
   * The page reads the controller once a frame, in two reads in a row. A change has been seen once two frames have been drawn and
   * two reads have come after it: a press that lets go before that is no press. `__seen()` waits for it.
   */
  window.__seen = () => {
    const frames = new Promise((ok) => { let n = 2; const step = () => (n-- > 0 ? requestAnimationFrame(step) : ok()); step() })
    const reads = new Promise((ok) => { const from = window.__polls; const look = () => (window.__polls >= from + 2 ? ok() : requestAnimationFrame(look)); look() })
    return Promise.all([frames, reads])
  }
  window.dispatchEvent(new Event('gamepadconnected'))
}

/** Gives the page a controller, before it loads. */
export const withPad = (page) => page.addInitScript(padScript)

/**
 * Presses a button for `ms` and until the page has read the controller with it pressed, then lets go and waits for the page to have
 * read it let go. A slow machine that draws a frame late must still be seen to have pressed, but a press is no longer than a frame,
 * however slow the frame: a longer one would be a hold, which repeats. It says how long it held, in ms.
 */
export const tap = (page, name, ms = 100) => page.evaluate(async ([n, t]) => {
  const from = performance.now()
  window.__hold(n, true)
  await Promise.all([new Promise((ok) => setTimeout(ok, t)), window.__seen()])
  const held = performance.now() - from
  window.__hold(n, false)
  await window.__seen()
  return held
}, [name, ms])

/**
 * Puts the stick through these positions, one every 16 ms (a frame at 60 Hz), then lets it go. By the clock, not by the page's
 * frames or its timers: a machine that is slow to run a timer skips the positions it has no time for, and the stick is held as long as
 * the test says (a hold longer than that is a hold, which repeats).
 */
export const feed = (page, frames) => page.evaluate(async (list) => {
  await new Promise((done) => {
    const from = performance.now()
    const step = () => {
      const i = Math.floor((performance.now() - from) / 16)
      if (i >= list.length) { window.__stick(0, 0, 0, 0); return done() }
      window.__stick(...list[i])
      setTimeout(step, 16)
    }
    step()
  })
  await window.__seen()
}, frames)

/** Counts every focus change from here on: `moves` says how many and to what. */
export const watchFocus = (page) => page.evaluate(() => {
  window.__focus = []
  document.addEventListener('focusin', (e) => window.__focus.push(e.target.getAttribute('data-id') ?? e.target.getAttribute('aria-label') ?? e.target.textContent.trim().slice(0, 30)))
})
export const moves = (page) => page.evaluate(() => window.__focus.slice())
