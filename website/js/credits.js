/* The credits on the home page, drawn by the page's own scroll. Loaded after home.js. */
(() => {
'use strict'
const { $, $$, still, clamp, hand } = window.Renplay
/* ------------------------------------------------------------------ credits: the roll follows the scroll, lit where the lantern passes
   The roll is scrubbed by the page's own scroll, like a film's credits under your hand: the wheel, a trackpad or a finger moves it up as the
   page goes down and back down as the page comes up. It is not a timer and it holds nothing: the page scrolls as it always does, the roll is
   only drawn at a place that depends on where the page is. It is empty as its window comes into view and complete when the window is in the middle of the screen. */
let lit = false
function creditsInit() {
  const credits = $('#credits'), rollEl = $('#roll'), win = $('#roll-window')
  if (!credits || !rollEl) return
  const lines = $$('div', rollEl)
  const io = new IntersectionObserver((es) => {
    for (const e of es) { lit = e.isIntersecting; if (e.isIntersecting) credits.classList.add('in') }
  }, { threshold: .25 })
  io.observe(credits)
  const light = () => {
    for (const el of lines) {
      const r = el.getBoundingClientRect()
      const d = Math.hypot(hand.x - (r.left + r.width / 2), (hand.y - (r.top + r.height / 2)) * 1.25)
      el.style.setProperty('--lit', clamp(1 - d / 330, 0, 1).toFixed(2))
    }
  }
  if (!still) lines.forEach((el) => el.style.setProperty('--lit', '0'))
  window.Renplay.onFrame(() => { if (lit) light() })
  if (still) return // a still list
  // where in the page's scroll the roll is empty (from) and complete (to)
  let from = 0, to = 1
  const measure = () => {
    const r = win.getBoundingClientRect()
    const top = r.top + scrollY
    const max = document.documentElement.scrollHeight - innerHeight
    // empty as the window comes up from the bottom, complete when it sits in the middle of the screen (below the header), never later than the end of the page
    from = top - innerHeight * .9
    to = Math.max(from + 160, Math.min(top - Math.max(76, (innerHeight - r.height) / 2), max))
  }
  let p = 0, shown = -1, held = false
  const draw = () => {
    const goal = held ? 1 : clamp((scrollY - from) / (to - from), 0, 1)
    p += (goal - p) * (held ? .25 : .22)
    if (Math.abs(goal - p) < .0006) p = goal
    if (p === shown) return
    shown = p
    rollEl.style.transform = `translate3d(0,${((1 - p) * 100).toFixed(2)}%,0)`
  }
  // a link reached by the keyboard opens the roll, so focus never lands on a line that is out of sight
  win.addEventListener('focusin', () => { held = true })
  win.addEventListener('focusout', () => { held = false })
  win.addEventListener('scroll', () => { win.scrollTop = 0 }, { passive: true })
  measure()
  addEventListener('resize', measure)
  addEventListener('load', measure)
  document.fonts?.ready.then(measure)
  new ResizeObserver(measure).observe(document.body) // the page above grew or shrank (a picture, the demo, a font)
  window.Renplay.onFrame(draw)
  draw()
}

creditsInit()
})()
