/* The demo on the home page: two real Renplays in two frames, one big and one a phone that is picked up. Loaded after home.js. */
(() => {
'use strict'
const { $, $$, still, touchy, lerp } = window.Renplay
const DEMO = 'https://demo.renplay.org'
const SAVE_KEY = 'renplay-demo-save'
function demoInit() {
  const nav = window.Renplay.nav, root = document.documentElement
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
  // A frame that has not said ready has no page of the demo to hear it (the laptop is never loaded on a phone), and the browser reports a message sent to one.
  const post = (name, type) => { if (state[name].ready) frames[name].contentWindow?.postMessage({ type }, DEMO) }
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

demoInit()
})()
