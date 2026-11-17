/* Renplay website, second prototype. No framework. Each part is a function that finds its element or returns. */
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
let shelfLean = null
const h1El = $('#h1')
function homeFrame(t, dt) {
  // the room itself never moves: only the light does, and the screen nearest the light answers it
  wakeFrame(dt)
  if (h1El && scrollY < innerHeight) { const r = h1El.getBoundingClientRect(); h1El.style.setProperty('--hx', (hand.x - r.left).toFixed(0) + 'px'); h1El.style.setProperty('--hy', (hand.y - r.top).toFixed(0) + 'px') }
  if (motesFrame && roomVisible()) motesFrame(t)
  if (creditsLit) litCredits()
  if (shelfLean) shelfLean()
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
  const typed = $('#typed'), choices = $('#choices'), after = $('#after'), story = $('#story'), replay = $('#replay')
  const afterText = after.textContent.trim()
  let i = 0, timer = 0, full = '', shown = 0, typing = false, picked = '', picking = false
  // the mark at the end of a finished line, as in a visual novel: a small blinking triangle. It is not a scroll hint.
  const mark = Object.assign(document.createElement('i'), { className: 'mark' })
  mark.setAttribute('aria-hidden', 'true')
  const markOn = () => { if (sceneState === 'line' || sceneState === 'after') typed.append(mark) }
  const markOff = () => mark.remove()
  const setState = (s) => { sceneState = s; scene.dataset.scene = s }
  const say = (text, then) => {
    clearInterval(timer)
    full = text; shown = 0; typing = true; scene.dataset.typing = '1'
    typed.textContent = ''
    markOff()
    story.replaceChildren(Object.assign(document.createElement('p'), { textContent: text })) // for screen readers
    const done = () => { typing = false; delete scene.dataset.typing; typed.textContent = full; markOn(); then?.() }
    if (still) return done()
    timer = setInterval(() => {
      shown += 1
      typed.textContent = full.slice(0, shown)
      if (shown >= full.length) { clearInterval(timer); done() }
    }, 28)
  }
  const skipTyping = () => { clearInterval(timer); typing = false; delete scene.dataset.typing; typed.textContent = full; markOn() }
  const start = () => {
    i = 0; picked = ''
    for (const el of Object.values(devs)) el.classList.remove('on')
    if (still) for (const n of Object.keys(devs)) setWake(n, false)
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
          // the last line asks the question; the choice appears with it
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

/* ------------------------------------------------------------------ the demo: two real Renplays */
const DEMO = 'https://demo.renplay.org'
const SAVE_KEY = 'renplay-demo-save'
function demoInit() {
  const duo = $('#duo')
  if (!duo) return
  const lapScreen = $('#laptop-screen'), phoneScreen = $('#phone-screen')
  const lapFrame = $('#laptop-frame'), phoneFrame = $('#phone-frame')
  const liveText = $('#live-text'), after = $('#after-demo'), card = $('#livecard')
  const narrow = matchMedia('(max-width: 860px)')
  const state = { laptop: { ready: false }, phone: { ready: false }, engaged: false, nudged: false, near: false }
  const frames = { laptop: lapFrame, phone: phoneFrame }
  const screens = { laptop: lapScreen, phone: phoneScreen }

  // scale the frames so each keeps its real viewport (880x550, 390x844) and fits its box.
  // On a phone (a narrow touch screen) the phone frame is that phone's own screen, shrunk to fit the page: picked up, it is simply scale 1.
  let taken = false, barH = 52
  const stageEl = $('#demo-stage'), slot = $('#stage-slot'), bar = $('#stage-bar'), back = $('#demo-back'), dim = $('#stage-dim')
  const pickup = $('#pickup'), phoneEl = $('#phone'), cap = $('#phone-cap')
  const phoneMode = () => narrow.matches && touchy
  const measureBar = () => { if (root.classList.contains('taken')) return (barH = bar.offsetHeight); bar.style.display = 'flex'; barH = bar.offsetHeight; bar.style.display = ''; return barH }
  // The first fit already ran synchronously beside the markup. Use one formula
  // for that first paint, container resizes, rotation and returning from pick-up.
  const fit = () => { if (!taken) window.fitRenplayDemo() }
  fit(); addEventListener('resize', fit)
  new ResizeObserver(fit).observe(duo.parentElement)

  const url = (mode) => `${DEMO}/game/the-question?embed=${mode}`
  let loaded = false
  const load = () => {
    if (loaded) return
    loaded = true
    for (const [name, f] of Object.entries(frames)) {
      if (name === 'laptop' && narrow.matches) continue
      f.src = url(name)
      f.removeAttribute('tabindex')
      // if the demo cannot be reached, the poster stays and says so
      setTimeout(() => { if (!state[name].ready) { screens[name].classList.add('late'); if (!state.laptop.ready && !state.phone.ready) liveText.textContent = 'The demo could not be reached just now.' } }, 4000)
    }
  }
  // load the frames only when the section is within a viewport
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (e.target === duo) {
        state.near = e.isIntersecting
        if (e.isIntersecting) load()
      }
    }
  }, { rootMargin: '45% 0px 45% 0px' })
  io.observe(duo)
  // nudge: if nobody has touched the demo a moment after it is in view, ask the Play button to breathe once
  let nudgeTimer = 0
  const view = new IntersectionObserver((es) => {
    for (const e of es) {
      clearInterval(nudgeTimer)
      duo.classList.toggle('far', !e.isIntersecting)
      if (e.isIntersecting && !state.engaged && !state.nudged) {
        const since = performance.now()
        const t = narrow.matches ? 'phone' : 'laptop'
        // wait for the frame to be ready, then for 1.2 s of being looked at
        nudgeTimer = setInterval(() => {
          if (state.engaged || state.nudged) return clearInterval(nudgeTimer)
          if (state[t].ready && performance.now() - since > 1200) { state.nudged = true; duo.dataset.nudged = t; clearInterval(nudgeTimer); post(t, 'renplay-embed:nudge') }
        }, 300)
      }
    }
  }, { threshold: .35 })
  view.observe(duo)

  const echo = { from: '', at: 0 }
  const post = (name, type) => frames[name]?.contentWindow?.postMessage({ type }, DEMO)
  const ago = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
    return s < 5 ? 'just now' : s < 60 ? `${s} seconds ago` : `${Math.round(s / 60)} minutes ago`
  }
  const showCard = (d) => {
    if (!d || !d.label) { card.dataset.state = 'empty'; $('#card-state').textContent = narrow.matches ? 'Saves from the demo appear here as you make them' : 'Nothing saved yet'; return }
    card.dataset.state = 'saved'
    $('#card-state').textContent = `Continue, ${ago(d.time)}`
  }
  try { const d = JSON.parse(sessionStorage.getItem(SAVE_KEY)); if (d && Date.now() - d.time < 36e5) showCard(d); else showCard(null) } catch { showCard(null) }
  setInterval(() => { try { const d = JSON.parse(sessionStorage.getItem(SAVE_KEY)); if (d && card.dataset.state === 'saved') showCard(d) } catch {} }, 15000)

  addEventListener('message', (event) => {
    if (event.origin !== DEMO) return
    const name = Object.keys(frames).find((n) => frames[n].contentWindow && event.source === frames[n].contentWindow)
    if (!name) return
    const m = event.data
    if (!m || typeof m.type !== 'string') return
    if (m.type === 'renplay-embed:ready') {
      state[name].ready = true
      if (!state.engaged && liveText.textContent.startsWith('The demo could not')) liveText.textContent = 'Live. Go on, press Play.'
      screens[name].classList.remove('late')
      screens[name].classList.add('ready')
      if (still) screens[name].querySelector('.poster').style.display = 'none'
    } else if (m.type === 'renplay-embed:engaged') {
      if (!state.engaged) {
        state.engaged = true
        liveText.textContent = 'That was the real thing.'
        after.classList.add('show')
      }
    } else if (m.type === 'renplay-embed:saved') {
      // the other frame reports the same save back once it has refreshed: that is an echo, not a second save
      if (echo.from && echo.from !== name && Date.now() - echo.at < 5000) return
      echo.from = name; echo.at = Date.now()
      const other = name === 'laptop' ? 'phone' : 'laptop'
      post(other, 'renplay-embed:refresh')
      const d = { label: m.label, time: m.time, gameId: m.gameId }
      sessionStorage.setItem(SAVE_KEY, JSON.stringify(d))
      showCard(d)
      duo.classList.add('flash'); setTimeout(() => duo.classList.remove('flash'), 1600)
      if (m.label) liveText.textContent = narrow.matches ? 'Saved on the server. The card above has it.' : name === 'laptop' ? 'Saved. Look at the phone.' : 'Saved on the phone. The laptop has it.'
    }
  })

  /* ---- picking the phone up, on a phone only. In the page the frame is inert, so the page scrolls over it as over a picture and there is
     one scroll. The person taps the phone (or the button under it, a link without JavaScript) and it rises from its place on the page into the
     hand: the same screen, only bigger, under a bar with Back to the page. Putting it down (Back, pulling the bar down, Esc, the browser's Back)
     plays the rise backwards into the same place, and the page, which was held still underneath, has not moved. Nothing happens on its own. */
  let scrollBefore = 0, pushed = false, home = null, pressed = false, settleScroll = -1
  const inertList = () => [nav, $('#top'), $('#gallery'), $('#install'), $('#credits'), $('#demo .sec-head'), $('#demo .skip')].filter(Boolean)
  const RISE = 'cubic-bezier(.32,.72,0,1)', SETTLE = 'cubic-bezier(.22,1,.36,1)'
  // where the screen sits in the page, and the transform that puts the full-screen stage exactly there
  const screenRect = () => { const r = screens.phone.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight } }
  const homeTransform = (h, dip = 1) => {
    const s = h.w / innerWidth * dip, dx = h.w * (1 - dip) / 2, dy = h.h * (1 - dip) / 2
    return `translate(${(h.x + dx).toFixed(1)}px,${(h.y + dy - barH * s).toFixed(1)}px) scale(${s.toFixed(4)})`
  }
  // iOS Safari scrolls the page behind an overflow:hidden overlay; a body held fixed at minus the scroll cannot move
  const lock = () => { scrollBefore = scrollY; document.body.style.top = -scrollBefore + 'px'; root.classList.add('taken') }
  const unlock = () => { root.classList.remove('taken'); document.body.style.top = ''; scrollTo({ top: scrollBefore, behavior: 'instant' }) }
  const run = async (el, kf, opts) => { const a = el.animate(kf, opts); await a.finished.catch(() => {}); a.cancel() }
  async function enter() {
    if (taken || !phoneMode()) return
    taken = true
    home = screenRect()
    const dip = pressed ? .98 : 1
    pressed = false; phoneEl.classList.remove('pressed')
    slot.style.height = slot.offsetHeight + 'px' // the page keeps its shape under the stage
    // the history entry goes in before the page is held, so the browser remembers the real scroll, and it is not let to restore any itself
    try { history.scrollRestoration = 'manual'; history.pushState({ renplayDemo: 1 }, ''); pushed = true } catch {}
    lock()
    duo.classList.add('live')
    inertList().forEach((e) => (e.inert = true))
    stageEl.style.transform = ''; stageEl.style.opacity = ''
    measureBar()
    for (const f of Object.values(frames)) f.removeAttribute('tabindex')
    state.nudged = false; clearInterval(nudgeTimer)
    bar.focus({ preventScroll: true })
    if (!still) {
      root.classList.add('rising')
      dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' })
      bar.animate([{ opacity: 0 }, { opacity: 0, offset: .4 }, { opacity: 1 }], { duration: 560, easing: 'ease-out' })
      // only the screen flies: the bar's strip is clipped away at the start and the corners are the phone's
      await run(stageEl, [{ transform: homeTransform(home, dip), clipPath: `inset(${barH}px 0 0 0 round 32px)` }, { transform: 'none', clipPath: 'inset(0 round 0)' }], { duration: 560, easing: RISE })
      root.classList.remove('rising')
    }
    nudgeTimer = setInterval(() => { if (state.engaged || state.nudged) return clearInterval(nudgeTimer); if (state.phone.ready) { state.nudged = true; clearInterval(nudgeTimer); post('phone', 'renplay-embed:nudge') } }, 400)
  }
  async function leave(fromPop) {
    if (!taken) return
    taken = false
    const ownBack = pushed && !fromPop
    if (ownBack) { pushed = false; try { history.back() } catch {} } else pushed = false
    clearInterval(nudgeTimer)
    if (!still) {
      root.classList.add('leaving')
      const cur = getComputedStyle(stageEl).transform
      dim.animate([{ opacity: getComputedStyle(dim).opacity }, { opacity: 0 }], { duration: 380, easing: 'ease-out' })
      const barOut = bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' })
      if (home && home.vw === innerWidth && home.vh === innerHeight) {
        // back into its place on the page
        await run(stageEl, [{ transform: cur, clipPath: 'inset(0 round 0)' }, { transform: homeTransform(home), clipPath: `inset(${barH}px 0 0 0 round 32px)` }], { duration: 440, easing: SETTLE })
      } else {
        // the screen turned while it was up: there is no place to fly to, so it sets down and fades
        await run(stageEl, [{ transform: cur, opacity: 1 }, { transform: 'translateY(40px)', opacity: 0 }], { duration: 320, easing: SETTLE })
      }
      barOut.cancel()
      root.classList.remove('leaving')
    }
    unlock()
    if (ownBack) settleScroll = scrollBefore; else try { history.scrollRestoration = 'auto' } catch {}
    duo.classList.remove('live')
    slot.style.height = ''
    inertList().forEach((e) => (e.inert = false))
    stageEl.style.transform = ''; stageEl.style.opacity = ''
    fit()
  }
  const setMode = () => {
    root.classList.toggle('handheld', phoneMode())
    cap.textContent = phoneMode() ? 'Tap the phone to pick it up' : 'The phone, live'
    if (!phoneMode() && taken) leave(false)
    fit()
  }
  narrow.addEventListener('change', setMode); setMode()
  // the way in: the phone itself
  pickup.addEventListener('click', (e) => { if (!phoneMode()) return; e.preventDefault(); enter() })
  pickup.addEventListener('pointerdown', () => { if (phoneMode() && !still) { pressed = true; phoneEl.classList.add('pressed') } })
  const unpress = () => { if (!taken) { pressed = false; phoneEl.classList.remove('pressed') } }
  pickup.addEventListener('pointercancel', unpress); pickup.addEventListener('pointerleave', unpress)
  pickup.addEventListener('pointerup', () => setTimeout(unpress, 400))
  // the ways out
  back.addEventListener('click', () => leave(false))
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && taken) { e.preventDefault(); leave(false) } })
  addEventListener('popstate', () => {
    if (taken) return leave(true)
    // the entry our own Back popped: hold the page where it was, then let the browser keep scroll positions again
    if (settleScroll >= 0) { scrollTo({ top: settleScroll, behavior: 'instant' }); settleScroll = -1; try { history.scrollRestoration = 'auto' } catch {} }
  })
  // pull the bar down and the phone follows the finger, sinking a little; let go past the line and it goes back to the page, else it springs back
  let pull = null
  bar.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; pull = { y: e.clientY, d: 0, id: e.pointerId, t: performance.now(), v: 0, ly: e.clientY }; bar.setPointerCapture?.(e.pointerId) })
  bar.addEventListener('pointermove', (e) => {
    if (!pull) return
    const now = performance.now()
    pull.v = lerp(pull.v, (e.clientY - pull.ly) / Math.max(1, now - pull.t), .4); pull.ly = e.clientY; pull.t = now
    pull.d = Math.max(0, e.clientY - pull.y)
    stageEl.style.transform = `translateY(${(pull.d * .85).toFixed(1)}px) scale(${(1 - pull.d / 2400).toFixed(4)})`
    dim.style.opacity = String(1 - Math.min(.6, pull.d / 500))
  })
  const release = () => {
    if (!pull) return
    const { d, v } = pull; pull = null
    if (d > 90 || (d > 30 && v > .6)) { dim.style.opacity = ''; leave(false); return }
    const a = stageEl.animate([{ transform: stageEl.style.transform }, { transform: 'none' }], { duration: 320, easing: SETTLE })
    stageEl.style.transform = ''; dim.style.opacity = ''
    a.finished.catch(() => {})
  }
  bar.addEventListener('pointerup', release); bar.addEventListener('pointercancel', release)
  // a bar that is dragged must not scroll the page under it on a touch screen
  bar.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })
  window.renplayDemo = { enter, leave, get taken() { return taken } }

  /* ---- coming back from playing full window (a touch screen plays in the top window): the frames ask the library again */
  const AWAY = 'renplay-demo-away'
  addEventListener('pagehide', () => { if (state.engaged) { try { sessionStorage.setItem(AWAY, String(Date.now())) } catch {} } })
  const welcomeBack = (persisted) => {
    let away = null
    try { away = sessionStorage.getItem(AWAY); sessionStorage.removeItem(AWAY) } catch {}
    if (!away) return
    const go = () => {
      for (const n of Object.keys(frames)) post(n, 'renplay-embed:refresh')
      // a frame that was kept alive reports the new save itself; one that loaded again only shows it under Resume
      if (card.dataset.state !== 'saved') { card.dataset.state = 'saved'; $('#card-state').textContent = 'Back from playing. Your save is under Resume.' }
    }
    if (persisted) go(); else { const t = setInterval(() => { if (Object.keys(frames).some((n) => state[n].ready)) { clearInterval(t); go() } }, 400); setTimeout(() => clearInterval(t), 15000) }
  }
  addEventListener('pageshow', (e) => welcomeBack(e.persisted))
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.engaged) for (const n of Object.keys(frames)) post(n, 'renplay-embed:refresh') })
  narrow.addEventListener('change', () => { fit(); if (loaded && !narrow.matches && !lapFrame.src) { lapFrame.src = url('laptop'); lapFrame.removeAttribute('tabindex') } })
}

/* ------------------------------------------------------------------ the gallery shelf */
function shelfInit() {
  const shelf = $('#shelf')
  if (!shelf) return
  // every card leans toward the light (the hand), the one under it a little more
  const cardsAll = $$('.card', shelf)
  const wrapEl = shelf.parentElement
  let shelfSeen = false
  new IntersectionObserver((es) => { shelfSeen = es[0].isIntersecting }, { rootMargin: '80px' }).observe(wrapEl)
  const lean = window.Renplay.lean(() => cardsAll, { ry: 9, rx: 7 })
  if (lean) shelfLean = () => { if (shelfSeen) lean() }
  shelf.addEventListener('focusin', (e) => { const li = e.target.closest?.('.card'); if (li) tintFrom(li) })

  // the shelf is lit by the card in the middle of it
  const tintFrom = (li) => { if (li.dataset.tint) shelf.parentElement.style.setProperty('--tint', li.dataset.tint); else shelf.parentElement.style.removeProperty('--tint') }
  const cards = $$('.card', shelf)
  const mid = () => {
    const r = shelf.getBoundingClientRect(), c = r.left + r.width * .5
    let best = cards[0], bd = 1e9
    for (const li of cards) { const lr = li.getBoundingClientRect(), d = Math.abs(lr.left + lr.width / 2 - c); if (d < bd) { bd = d; best = li } }
    tintFrom(best)
    const lr = best.getBoundingClientRect()
    shelf.parentElement.style.setProperty('--shelf-x', ((lr.left + lr.width / 2 - r.left) / r.width * 100).toFixed(0) + '%')
  }
  let ticking = false
  shelf.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; mid() }) } }, { passive: true })
  mid()

  const step = () => (cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().left)
  $('#shelf-prev').addEventListener('click', () => shelf.scrollBy({ left: -step() * 2, behavior: still ? 'auto' : 'smooth' }))
  $('#shelf-next').addEventListener('click', () => shelf.scrollBy({ left: step() * 2, behavior: still ? 'auto' : 'smooth' }))
  shelf.addEventListener('keydown', (e) => {
    if (e.target !== shelf) return
    if (e.key === 'ArrowRight') { e.preventDefault(); shelf.scrollBy({ left: step(), behavior: 'smooth' }) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); shelf.scrollBy({ left: -step(), behavior: 'smooth' }) }
  })

  // a mouse drags it, and a flick carries on and then snaps; touch is the browser's own
  let drag = null
  shelf.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    drag = { x: e.clientX, left: shelf.scrollLeft, moved: 0, v: 0, t: performance.now(), lx: e.clientX, id: e.pointerId }
  })
  addEventListener('pointermove', (e) => {
    if (!drag) return
    const dx = e.clientX - drag.x
    if (!shelf.classList.contains('dragging')) {
      if (Math.abs(dx) < 5) return
      shelf.classList.add('dragging')
      shelf.setPointerCapture?.(drag.id)
    }
    const now = performance.now()
    drag.v = lerp(drag.v, (e.clientX - drag.lx) / Math.max(1, now - drag.t), .4)
    drag.lx = e.clientX; drag.t = now
    drag.moved = Math.abs(dx)
    shelf.scrollLeft = drag.left - dx
  })
  const release = () => {
    if (!drag) return
    const d = drag; drag = null
    if (!shelf.classList.contains('dragging')) return
    // momentum: carry the flick, then ease to the nearest card
    let v = -d.v * 16
    const carry = () => {
      shelf.scrollLeft += v
      v *= .93
      if (Math.abs(v) > .6) return requestAnimationFrame(carry)
      shelf.classList.remove('dragging')
      let best = 0, bd = 1e9
      for (const li of cards) { const x = li.offsetLeft - parseFloat(getComputedStyle(shelf).scrollPaddingLeft || 0); if (Math.abs(x - shelf.scrollLeft) < bd) { bd = Math.abs(x - shelf.scrollLeft); best = x } }
      shelf.scrollTo({ left: best, behavior: still ? 'auto' : 'smooth' })
    }
    if (still) { shelf.classList.remove('dragging'); return }
    carry()
  }
  addEventListener('pointerup', release)
  addEventListener('pointercancel', release)
  // a drag must not open the card under it
  shelf.addEventListener('click', (e) => { if (drag?.moved > 5) e.preventDefault() }, true)
  shelf.addEventListener('dragstart', (e) => e.preventDefault())
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

/* ------------------------------------------------------------------ credits: the roll follows the scroll, lit where the lantern passes
   The roll is scrubbed by the page's own scroll, like a film's credits under your hand: the wheel, a trackpad or a finger moves it up as the
   page goes down and back down as the page comes up. It is not a timer and it holds nothing: the page scrolls as it always does, the roll is
   only drawn at a place that depends on where the page is. It is empty as its window comes into view and complete when the window is in the middle of the screen. */
let creditsLit = false
function creditsInit() {
  const credits = $('#credits'), rollEl = $('#roll'), win = $('#roll-window')
  if (!credits || !rollEl) return
  const lines = $$('div', rollEl)
  const io = new IntersectionObserver((es) => {
    for (const e of es) { creditsLit = e.isIntersecting; if (e.isIntersecting) credits.classList.add('in') }
  }, { threshold: .25 })
  io.observe(credits)
  window.litCredits = litCredits
  function litCredits() {
    for (const el of lines) {
      const r = el.getBoundingClientRect()
      const d = Math.hypot(hand.x - (r.left + r.width / 2), (hand.y - (r.top + r.height / 2)) * 1.25)
      el.style.setProperty('--lit', clamp(1 - d / 330, 0, 1).toFixed(2))
    }
  }
  if (!still) lines.forEach((el) => el.style.setProperty('--lit', '0'))
  if (still) return // a still list
  // where in the page's scroll the roll is empty (from) and complete (to)
  let from = 0, to = 1
  const measure = () => {
    if (root.classList.contains('taken')) return // the page is held fixed under the picked-up phone: its numbers would be wrong
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
function litCredits() { window.litCredits?.() }

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
demoInit()
shelfInit()
installInit()
creditsInit()
addEventListener('load', () => { layout() })
addEventListener('resize', () => { layout() })
tallMQ.addEventListener('change', layout)
document.fonts?.ready.then(layout)
addEventListener('scroll', () => requestAnimationFrame(updateSky), { passive: true })
measureStops(); updateSky()
window.Renplay.onFrame(homeFrame)
})()
