/* The home page: the room (its sky, the light and the screens that wake), the scene and the install tabs. The demo (demo.js), the shelf
   (shelf.js) and the credits (credits.js) load after it. No framework. Each part is a function that finds its element or returns. */
(() => {
'use strict'
const { $, $$, still, touchy, clamp, lerp, hand } = window.Renplay
const nav = window.Renplay.nav
const light = window.Renplay.light
const root = document.documentElement

/* ------------------------------------------------------------------ the room: geometry */
// Hit-test geometry stays in rooms.js. These lit patches include the source painting's own
// glass reflections, occluding rim and masked furniture spill; no warped screen sits on the page.
const ROOMS = window.RENPLAY_ROOMS, LIT_ROOMS = window.RENPLAY_LIT_ROOMS
const tallMQ = matchMedia('(max-aspect-ratio: 1/1)')
const stage = $('#stage')
const room = $('#room')
const devs = Object.fromEntries($$('.dev').map((d) => [d.dataset.dev, d]))
let litReady = false
let quads = {} // per device: the quad in stage pixels, kept for hit tests
function placeDevices() {
  const kind = tallMQ.matches ? 'tall' : 'wide'
  const r = ROOMS[kind]
  const sw = stage.offsetWidth, sh = stage.offsetHeight
  for (const [name, el] of Object.entries(devs)) {
    const d = LIT_ROOMS[kind][name]
    el.style.cssText = `left:${d.x / r.w * 100}%;top:${d.y / r.h * 100}%;width:${d.w / r.w * 100}%;height:${d.h / r.h * 100}%;--w:${wake[name].toFixed(3)}`
    quads[name] = r[name].q.map(([x, y]) => [x * sw / r.w, y * sh / r.h])
    const source = $('source', el), img = $('img', el)
    // Select one orientation and resolution, after the dark room has painted.
    // No transient fallback request, and no hidden wide download on a phone.
    const width = kind === 'tall' ? 832 : sw * devicePixelRatio <= 1250 ? 1200 : 1600
    source.dataset.srcset = d.avif[width]
    img.dataset.src = d.webp[width]
    img.width = d.w; img.height = d.h
    if (litReady) { source.srcset = source.dataset.srcset; img.src = img.dataset.src }
  }
}

/* ------------------------------------------------------------------ the sky and the ink: the scroll */
let tops = [0, 1, 2, 3, 4]
window.Renplay.solidAt = () => innerHeight * .5
function measureStops() {
  const y = (el) => el.getBoundingClientRect().top + scrollY
  const demo = $('#demo'), gal = $('#gallery'), inst = $('#install'), foot = $('#credits')
  // 0 at the top, 1 when the demo's heading arrives, then one stop per section, 4 at the credits
  tops = [0, y(demo) + innerHeight * .25, y(gal), y(inst), y(foot)]
}
const smooth = (t) => t * t * (3 - 2 * t)
function stopAt(sy) {
  for (let i = 0; i < 4; i++) if (sy < tops[i + 1]) return i + clamp((sy - tops[i]) / (tops[i + 1] - tops[i]), 0, 1)
  return 4
}
let lastSky = ''
function updateSky() {
  const t = stopAt(scrollY)
    stage.classList.toggle('night', t > 3.3)
  const la = String(roomVisible() ? .85 : .4)
  if (la !== lastLa) { lastLa = la; light.style.setProperty('--la', la) }
  // dusk is 1 at stop 0 and gone by 2, the evening plate peaks at 2, the night plate is full from 3.8
  const eve = t <= 1 ? smooth(clamp(t, 0, 1)) * .55 : t <= 2 ? lerp(.55, 1, smooth(t - 1)) : 1
  const night = clamp((t - 2.2) / 1.6, 0, 1)
  const key = `${eve.toFixed(3)}|${night.toFixed(3)}`
  if (key === lastSky) return
  lastSky = key
  stage.style.setProperty('--o-eve', eve.toFixed(3))
  stage.style.setProperty('--o-night', smooth(night).toFixed(3))
  // the room sinks into ink, and its warm light stays in the screens
  const dark = clamp(t / 4, 0, 1)
  stage.style.setProperty('--b', (.9 - .5 * smooth(dark)).toFixed(3))
  stage.style.setProperty('--sat', (1 - .12 * dark).toFixed(3))
}
let lastLa = ''
const roomVisible = () => scrollY < innerHeight * .9 || scrollY > tops[4] - innerHeight * .8

/* ------------------------------------------------------------------ what answers the light on the home page */
const h1El = $('#h1')
function homeFrame(t, dt) {
  // the room itself never moves: only the light does, and the screen nearest the light answers it
  wakeFrame(dt)
  if (h1El && scrollY < innerHeight) { const r = h1El.getBoundingClientRect(); h1El.style.setProperty('--hx', (hand.x - r.left).toFixed(0) + 'px'); h1El.style.setProperty('--hy', (hand.y - r.top).toFixed(0) + 'px') }
  if (motesFrame && roomVisible()) motesFrame(t)
}
/* A screen wakes as the light comes near it, in step with how near: a dark screen that lights up under the hand, a little at the edge of the
   light and fully in its middle, and throws its colour on what is around it. Nothing flips: each screen's wake (0 to 1) follows the light's
   distance and eases toward it, up quickly and down slowly, and the CSS reads it from --w. The screen chosen in the scene stays on. */
const wake = { laptop: 0, tablet: 0, phone: 0 }
function wakeFrame(dt) {
  const sr = stage.getBoundingClientRect()
  const k = sr.width / stage.offsetWidth // the stage is drawn a little larger than its layout box
  const centres = {}
  for (const [name, q] of Object.entries(quads)) centres[name] = [sr.left + (q[0][0] + q[2][0]) / 2 * k, sr.top + (q[0][1] + q[2][1]) / 2 * k]
  const names = Object.keys(centres)
  const away = !roomVisible() || (scrollY > innerHeight * .5 && scrollY < tops[4] - innerHeight * .8)
  const night = stage.classList.contains('night')
  const woke = stage.classList.contains('woke')
  for (const name of names) {
    const el = devs[name]
    const [cx, cy] = centres[name]
    let target = 0
    if (el.classList.contains('on')) target = 1
    else if (!away && !woke) {
      // the light reaches a screen over a distance that is kept short of the next screen, so two close screens never both answer one light
      let reach = Math.max(240, innerWidth * .2)
      for (const o of names) if (o !== name) reach = Math.min(reach, Math.hypot(cx - centres[o][0], cy - centres[o][1]) * .62)
      const t = clamp(1 - Math.hypot(hand.x - cx, hand.y - cy) / reach, 0, 1)
      target = smooth(clamp(t * 1.8, 0, 1)) * (night ? .7 : .92)
    }
    const w = wake[name]
    const next = w + (target - w) * (1 - Math.exp(-dt / (target > w ? 110 : 420)))
    // Always advance the easing state: skipping tiny steps used to leave a faint
    // image stuck on dark glass forever. Only skip redundant DOM writes.
    wake[name] = Math.abs(target - next) < .001 ? target : next
    const value = wake[name].toFixed(3)
    if (el.style.getPropertyValue('--w') !== value) el.style.setProperty('--w', value)
  }
}
function setWake(name, on) {
  // a screen set on by the scene, without the frame loop (reduced motion does not run one)
  wake[name] = on ? 1 : 0
  devs[name].style.setProperty('--w', String(wake[name]))
}

/* motes: dust in the light (shared.js) */
let motesFrame = null
function motesInit() { motesFrame = window.Renplay.motes($('#motes'), stage) }

/* ------------------------------------------------------------------ the scene: three lines that type, one choice, the menu */
const scene = $('#scene')
let sceneState = 'line'
// The opening lines are in the HTML (#story), so a page without JavaScript reads them too. The typewriter and the choices are drawn from them.
const SCRIPT = scene && $$('#story p').map((p) => p.textContent.trim())
function sceneInit() {
  if (!scene) return
  // The typed line has its own span, beside the hidden copies of every line that keep the box as tall as its longest (index.html).
  const t = $('#typed .t'), choices = $('#choices'), after = $('#after'), story = $('#story'), replay = $('#replay')
  const afterText = after.textContent.trim()
  let i = 0, timer = 0, full = '', shown = 0, typing = false, picked = '', picking = false
  // the mark at the end of a finished line, as in a visual novel: a small blinking triangle. It is not a scroll hint.
  const mark = Object.assign(document.createElement('i'), { className: 'mark' })
  mark.setAttribute('aria-hidden', 'true')
  const markOn = () => { if (sceneState === 'line' || sceneState === 'after') t.append(mark) }
  const markOff = () => mark.remove()
  const setState = (s) => { sceneState = s; scene.dataset.scene = s }
  const say = (text, then) => {
    clearInterval(timer)
    full = text; shown = 0; typing = true; scene.dataset.typing = '1'
    t.textContent = ''
    markOff()
    story.replaceChildren(Object.assign(document.createElement('p'), { textContent: text })) // for screen readers
    const done = () => { typing = false; delete scene.dataset.typing; t.textContent = full; markOn(); then?.() }
    if (still) return done()
    timer = setInterval(() => {
      shown += 1
      t.textContent = full.slice(0, shown)
      if (shown >= full.length) { clearInterval(timer); done() }
    }, 28)
  }
  const skipTyping = () => { clearInterval(timer); typing = false; delete scene.dataset.typing; t.textContent = full; markOn() }
  const start = () => {
    i = 0; picked = ''
    for (const el of Object.values(devs)) el.classList.remove('on')
    if (still) for (const n of Object.keys(devs)) setWake(n, false)
    delete scene.dataset.last
    setState('line')
    say(SCRIPT[0])
  }
  const offerChoice = () => { setState('choice'); markOff() }
  const advance = () => {
    scene.classList.add('seen')
    if (typing) return skipTyping()
    if (sceneState === 'line') {
      i += 1
      if (i < SCRIPT.length) {
        say(SCRIPT[i])
        if (i === SCRIPT.length - 1) {
          // the last line asks the question; the choice appears with it, and its place is kept from now on so the box does not grow when it comes
          scene.dataset.last = ''
          const showNow = () => offerChoice()
          const tm = setInterval(() => { if (!typing) { clearInterval(tm); showNow() } }, 60)
        }
      }
    } else if (sceneState === 'after') {
      setState('menu')
      markOff()
    }
  }
  const choose = (name) => {
    if (picking) return
    picking = true
    // the choice shows it was heard, then the screen wakes
    const a = $(`a[data-dev="${name}"]`, choices)
    a?.classList.add('picked')
    const go = () => {
      picking = false
      a?.classList.remove('picked')
      picked = name
      for (const [n, el] of Object.entries(devs)) el.classList.toggle('on', n === name)
      if (still) for (const n of Object.keys(devs)) setWake(n, n === name)
      stage.classList.add('woke')
      setState('after')
      say(afterText, () => {})
      // the chosen screen is shown in the demo below: remember which one
      sessionStorage.setItem('renplay-device', name)
    }
    // reduced motion moves nothing, but the choice is still seen to be heard for a moment
    setTimeout(go, still ? 240 : 360)
  }
  choices.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-dev]')
    if (!a) return
    e.preventDefault()
    choose(a.dataset.dev)
  })
  scene.addEventListener('click', (e) => {
    if (e.target.closest('a,button,.choices')) return
    if (!still) { const r = document.createElement('i'); r.className = 'ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.append(r); setTimeout(() => r.remove(), 750) }
    advance()
  })
  scene.addEventListener('keydown', (e) => {
    if (e.target !== scene) return
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance() }
  })
  addEventListener('keydown', (e) => {
    if (sceneState !== 'choice' || scrollY > innerHeight * .5) return
    if (e.target.closest?.('input,textarea')) return
    const pick = { 1: 'phone', 2: 'tablet', 3: 'laptop' }[e.key]
    if (pick) choose(pick)
  })
  replay.addEventListener('click', () => { start() })
  // keep clicks on the room outside the scene (the title area is part of it already)
  start()
}

/* ------------------------------------------------------------------ install tabs and copy */
function installInit() {
  const tabs = $$('.tabs button')
  if (!tabs.length) return
  const pick = (b) => {
    tabs.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); x.tabIndex = x === b ? 0 : -1 })
    $$('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab))
  }
  tabs.forEach((b) => b.addEventListener('click', () => pick(b)))
  $('.tabs').addEventListener('keydown', (e) => {
    const to = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (!to) return
    const next = tabs[(tabs.indexOf(document.activeElement) + to + tabs.length) % tabs.length]
    next.focus(); pick(next)
  })
  $$('.copy').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.previousElementSibling.innerText) } catch {}
    b.textContent = 'Copied'
    setTimeout(() => (b.textContent = 'Copy'), 1600)
  }))
}

/* ------------------------------------------------------------------ what the first screen does not need loads when the page is idle */
function lateLoad() {
  const go = () => {
    litReady = true
    $$('source[data-srcset]').forEach((s) => { s.srcset = s.dataset.srcset })
    $$('img[data-src]').forEach((i) => { i.src = i.dataset.src })
  }
  addEventListener('load', async () => {
    await Promise.all($$('.art', stage).map((img) => img.decode().catch(() => {})))
    await document.fonts.ready
    // Startup RAFs can precede Chromium's first actual paint. Wait for the paint
    // entry where available; other engines get a decoded room and two frames.
    if (window.PerformanceObserver?.supportedEntryTypes.includes('paint') && !performance.getEntriesByName('first-contentful-paint').length) {
      await new Promise((resolve) => {
        const observer = new PerformanceObserver((list) => {
          if (list.getEntries().some((e) => e.name === 'first-contentful-paint')) { observer.disconnect(); resolve() }
        })
        observer.observe({ type: 'paint', buffered: true })
      })
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 1500 })
      else setTimeout(go, 600)
    }))
  })
}

/* ------------------------------------------------------------------ go */
function layout() { placeDevices(); measureStops(); lastSky = ''; updateSky() }
placeDevices()
lateLoad()
motesInit()
sceneInit()
installInit()
addEventListener('load', () => { layout() })
addEventListener('resize', () => { layout() })
tallMQ.addEventListener('change', layout)
document.fonts?.ready.then(layout)
addEventListener('scroll', () => requestAnimationFrame(updateSky), { passive: true })
measureStops(); updateSky()
window.Renplay.onFrame(homeFrame)
})()
