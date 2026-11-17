/* Renplay website, the parts every page shares: helpers, the lantern (the light that follows the hand), the header.
   Pages add their own work with Renplay.onFrame(fn). No framework. */
(() => {
'use strict'
const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const still = matchMedia('(prefers-reduced-motion: reduce)').matches
const touchy = matchMedia('(hover: none)').matches

/* ------------------------------------------------------------------ the lantern
   Mouse: the light is under the pointer. Touch: it is under the finger, stays where the finger last was and breathes
   there, is pushed along by the scroll and springs back, and swells where a tap lands. Before any touch it drifts. */
const light = $('#light')
const hand = { x: innerWidth * .28, y: innerHeight * .34, tx: innerWidth * .28, ty: innerHeight * .34, px: 0, py: 0, tpx: 0, tpy: 0, down: false, last: 0, seen: false, kick: 0, pulse: 0, bx: 0, by: 0 }
let lastY = scrollY
function pointerTo(x, y) {
  hand.bx = hand.tx = x; hand.by = hand.ty = y
  hand.tpx = clamp(x / innerWidth * 2 - 1, -1, 1)
  hand.tpy = clamp(y / innerHeight * 2 - 1, -1, 1)
  hand.last = performance.now()
  hand.seen = true
}
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.pointerType === 'pen') pointerTo(e.clientX, e.clientY) }, { passive: true })
addEventListener('pointerdown', (e) => { if (still) { hand.x = hand.tx = e.clientX; hand.y = hand.ty = e.clientY; place() } }, { passive: true })
addEventListener('touchstart', (e) => { hand.down = true; hand.pulse = 1; pointerTo(e.touches[0].clientX, e.touches[0].clientY) }, { passive: true })
addEventListener('touchmove', (e) => { pointerTo(e.touches[0].clientX, e.touches[0].clientY) }, { passive: true })
addEventListener('touchend', () => { hand.down = false; hand.last = performance.now() }, { passive: true })
addEventListener('touchcancel', () => { hand.down = false }, { passive: true })
// the page moving pushes the light, then it settles
addEventListener('scroll', () => { const d = scrollY - lastY; lastY = scrollY; hand.kick = clamp(hand.kick + d * .4, -160, 160) }, { passive: true })

function place() {
  if (!light) return
  light.style.transform = `translate3d(${hand.x.toFixed(1)}px,${hand.y.toFixed(1)}px,0) scale(${(1 + hand.pulse * .22).toFixed(3)})`
}
const hooks = []
let running = true
let prev = 0
function frame(t) {
  if (!running) return
  requestAnimationFrame(frame)
  const dt = Math.min(48, t - (prev || t)); prev = t
  if (still) return
  if (touchy && !hand.down && hand.seen) {
    // settled where the finger last was: a slow breath around that point, drawn out by the scroll
    const s = t / 2600
    hand.tx = hand.bx + Math.sin(s) * 14
    hand.ty = hand.by + Math.cos(s * .8) * 10 + hand.kick * .9
  } else if (!hand.seen || (touchy && !hand.down)) {
    // nobody has touched it yet: a slow path, its height following the scroll
    const s = t / 12000 * Math.PI * 2
    hand.tx = innerWidth * (.5 + .34 * Math.sin(s))
    hand.ty = innerHeight * (.42 + .16 * Math.cos(s * .7)) + hand.kick * .9
    hand.tpx = Math.sin(s) * .5; hand.tpy = Math.cos(s * .7) * .3
  } else if (!touchy) {
    // a mouse that has not moved for a while: the light stays under it, with the scroll's push
    hand.ty = hand.by + hand.kick * .5
  }
  hand.kick *= .9
  hand.pulse *= .93
  const k = hand.down ? .35 : .1
  hand.x = lerp(hand.x, hand.tx, k); hand.y = lerp(hand.y, hand.ty, k)
  hand.px = lerp(hand.px, hand.tpx, .07); hand.py = lerp(hand.py, hand.tpy + hand.kick / 400, .07)
  place()
  for (const fn of hooks) fn(t, dt)
}
document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { prev = 0; requestAnimationFrame(frame) } })

/* ------------------------------------------------------------------ header */
const nav = $('#nav')
const R = { $, $$, clamp, lerp, still, touchy, hand, light, nav, hooks, onFrame: (fn) => hooks.push(fn), solidAt: () => 8, place }
window.Renplay = R
function navInit() {
  if (!nav) return
  const btn = $('#menu-btn')
  const solid = () => nav.classList.toggle('solid', scrollY > R.solidAt() || nav.classList.contains('open'))
  addEventListener('scroll', solid, { passive: true })
  R.navSolid = solid
  solid()
  if (!btn) return
  const set = (o) => { nav.classList.toggle('open', o); btn.setAttribute('aria-expanded', String(o)); btn.textContent = o ? 'Close' : 'Menu'; solid() }
  btn.addEventListener('click', () => set(!nav.classList.contains('open')))
  $$('#nav-links a').forEach((a) => a.addEventListener('click', () => set(false)))
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) { set(false); btn.focus() } })
  addEventListener('pointerdown', (e) => { if (nav.classList.contains('open') && !e.target.closest('#nav')) set(false) }, { passive: true })
  matchMedia('(min-width: 861px)').addEventListener('change', () => set(false))
}

/* ------------------------------------------------------------------ motes: dust in the light, pushed about by the hand.
   Returns the function to call each frame, or null. */
R.motes = (cv, stage) => {
  if (!cv || still) return null
  const ctx = cv.getContext('2d')
  const N = touchy ? 34 : 64
  const sprite = document.createElement('canvas'); sprite.width = sprite.height = 32
  { const g = sprite.getContext('2d'); const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,226,190,1)'); r.addColorStop(.35, 'rgba(255,190,150,.5)'); r.addColorStop(1, 'rgba(255,170,140,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32) }
  let W = 0, H = 0
  const P = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), vx: 0, vy: 0, r: .7 + Math.random() * 1.8, z: .4 + Math.random() * .6, ph: Math.random() * 6.28, sp: .5 + Math.random() }))
  const size = () => { W = cv.width = Math.round(innerWidth * .75); H = cv.height = Math.round(innerHeight * .75) }
  size(); addEventListener('resize', size)
  let px = hand.x, py = hand.y
  return (t) => {
    ctx.clearRect(0, 0, W, H)
    const k = .75
    const hvx = hand.x - px, hvy = hand.y - py
    px = hand.x; py = hand.y
    const night = stage.classList.contains('night')
    ctx.globalCompositeOperation = 'lighter'
    for (const p of P) {
      p.vx += Math.sin(t / 3000 * p.sp + p.ph) * .004 * p.z + .0015
      p.vy += Math.cos(t / 3700 * p.sp + p.ph * 1.7) * .004 * p.z - .0008
      const sx = p.x * innerWidth, sy = p.y * innerHeight
      const dx = sx - hand.x, dy = sy - hand.y, d = Math.hypot(dx, dy)
      // the hand stirs them: the faster it moves, the harder they go
      if (d < 190) { const f = (1 - d / 190); p.vx += hvx * .06 * f * p.z + dx / (d + 40) * .06 * f; p.vy += hvy * .06 * f * p.z + dy / (d + 40) * .06 * f }
      p.vx *= .965; p.vy *= .965
      p.x += p.vx / innerWidth; p.y += p.vy / innerHeight
      if (p.x < -.02) p.x = 1.02; if (p.x > 1.02) p.x = -.02; if (p.y < -.02) p.y = 1.02; if (p.y > 1.02) p.y = -.02
      const lit = Math.pow(clamp(1 - d / 440, 0, 1), 1.5)
      let a = .06 + .8 * lit
      if (night) a = .1 + .5 * (.5 + .5 * Math.sin(t / 900 * p.sp + p.ph)) + .3 * lit
      const r = p.r * (night ? 3.4 : 3) * (1 + lit * .6)
      ctx.globalAlpha = clamp(a, 0, 1)
      ctx.drawImage(sprite, sx * k - r, sy * k - r, r * 2, r * 2)
    }
  }
}

/* ------------------------------------------------------------------ the room at night, for pages other than home.
   The same painting, cut in the same layers, with the night sky in the window and the ink pulled over it by `dim`. It does not move. */
R.mountRoom = (el, { dim = 0.42, sat = 0.85 } = {}) => {
  if (!el) return
  el.innerHTML = `<div class="stage night" id="stage" style="--b:${dim};--sat:${sat};--o-eve:1;--o-night:1">
    <div class="layer l-sky"><div class="sky"><picture><source media="(max-aspect-ratio: 1/1)" srcset="/img/room/sky-night-tall.webp"><img src="/img/room/sky-night-wide.webp" alt="" width="560" height="655" decoding="async"></picture></div></div>
    <div class="layer l-room"><picture>
      <source media="(max-aspect-ratio: 1/1)" type="image/avif" srcset="/img/room/room-tall.avif"><source media="(max-aspect-ratio: 1/1)" srcset="/img/room/room-tall.webp">
      <source type="image/avif" srcset="/img/room/room-wide.avif 1600w, /img/room/room-wide-1200.avif 1200w" sizes="100vw">
      <img class="art" src="/img/room/room-wide.webp" srcset="/img/room/room-wide.webp 1600w, /img/room/room-wide-1200.webp 1200w" sizes="100vw" alt="" width="1600" height="892" decoding="async"></picture></div>
    <div class="layer l-fg"><picture>
      <source media="(max-aspect-ratio: 1/1)" type="image/avif" srcset="/img/room/fg-tall.avif"><source media="(max-aspect-ratio: 1/1)" srcset="/img/room/fg-tall.webp">
      <source type="image/avif" srcset="/img/room/fg-wide.avif 1600w, /img/room/fg-wide-1200.avif 1200w" sizes="100vw"><img class="art" src="/img/room/fg-wide.webp" srcset="/img/room/fg-wide.webp 1600w, /img/room/fg-wide-1200.webp 1200w" sizes="100vw" alt="" width="1600" height="892" decoding="async"></picture></div>
    <div class="stage-grain"></div></div><canvas class="motes" id="motes"></canvas>`
  // the painting stays still: the pointer light and the dust are all that move
  const dust = R.motes($('#motes', el), $('#stage', el))
  R.onFrame((t) => dust?.(t))
}

/* ------------------------------------------------------------------ cards: each one leans toward the hand, the one under it a little more.
   `cards` is a function that returns the cards to lean now; each card's link takes the transform and the sheen's place. Returns the frame function
   (nothing under reduced motion). `lit` is called with the card nearest the hand, to light what is around it. */
R.lean = (cards, { ry = 8, rx = 6, lit } = {}) => {
  if (still) return null
  const state = new WeakMap()
  const hover = (c, on) => { (state.get(c) ?? state.set(c, { rx: 0, ry: 0, hover: false }).get(c)).hover = on }
  return () => {
    let best = null, bd = 1e9
    for (const c of cards()) {
      if (!c.dataset.w) { c.dataset.w = '1'; c.addEventListener('pointerenter', () => hover(c, true)); c.addEventListener('pointerleave', () => hover(c, false)) }
      const r = c.getBoundingClientRect()
      if (r.bottom < -60 || r.top > innerHeight + 60 || r.right < -40 || r.left > innerWidth + 40) continue
      const a = c.firstElementChild
      let s = state.get(c); if (!s) { s = { rx: 0, ry: 0, hover: false }; state.set(c, s) }
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const nx = clamp((hand.x - cx) / 520, -1, 1), ny = clamp((hand.y - cy) / 420, -1, 1)
      const k = s.hover ? 1.7 : 1
      s.ry = lerp(s.ry, nx * ry * k, 0.12); s.rx = lerp(s.rx, -ny * rx * k, 0.12)
      a.style.transform = `rotateY(${s.ry.toFixed(2)}deg) rotateX(${s.rx.toFixed(2)}deg)${s.hover ? ' translateZ(14px) translateY(-6px)' : ''}`
      a.style.setProperty('--gx', (50 + nx * 45).toFixed(0) + '%'); a.style.setProperty('--gy', (35 + ny * 45).toFixed(0) + '%')
      const d = Math.hypot(hand.x - cx, hand.y - cy)
      if (d < bd) { bd = d; best = c }
    }
    if (best && lit) lit(best)
  }
}
navInit()
requestAnimationFrame(frame)
place()
})()
