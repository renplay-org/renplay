/* The demo on the home page: on a wide screen two real Renplays in two frames, a laptop and a phone, where a save in one shows in the other.
   On a narrow screen no frame loads: the drawn phone is a link that opens the demo full screen (index.html). Loaded after home.js. */
(() => {
'use strict'
const { $, still } = window.Renplay
const DEMO = 'https://demo.renplay.org'
function demoInit() {
  const duo = $('#duo')
  if (!duo) return
  const lapScreen = $('#laptop-screen'), phoneScreen = $('#phone-screen')
  const lapFrame = $('#laptop-frame'), phoneFrame = $('#phone-frame')
  const liveText = $('#live-text')
  const narrow = matchMedia('(max-width: 860px)')
  const state = { laptop: { ready: false }, phone: { ready: false }, engaged: false, nudged: false }
  const frames = { laptop: lapFrame, phone: phoneFrame }
  const screens = { laptop: lapScreen, phone: phoneScreen }

  // The first fit already ran synchronously beside the markup (index.html): the same formula for the first paint, resizes and rotation.
  const fit = () => window.fitRenplayDemo()
  fit(); addEventListener('resize', fit)
  new ResizeObserver(fit).observe(duo.parentElement)

  const url = (mode) => `${DEMO}/game/the-question?embed=${mode}`
  let loaded = false
  const load = () => {
    if (loaded || narrow.matches) return
    loaded = true
    for (const [name, f] of Object.entries(frames)) {
      f.src = url(name)
      f.removeAttribute('tabindex')
      // if the demo cannot be reached, the poster stays and says so
      setTimeout(() => { if (!state[name].ready) { screens[name].classList.add('late'); if (!state.laptop.ready && !state.phone.ready) liveText.textContent = 'The demo could not be reached just now.' } }, 4000)
    }
  }
  // load the frames only when the section is within a viewport
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) load() }, { rootMargin: '45% 0px 45% 0px' })
  io.observe(duo)
  // nudge: if nobody has touched the demo a moment after it is in view, ask the Play button to breathe once
  let nudgeTimer = 0
  const view = new IntersectionObserver((es) => {
    for (const e of es) {
      clearInterval(nudgeTimer)
      if (e.isIntersecting && !state.engaged && !state.nudged) {
        const since = performance.now()
        // wait for the frame to be ready, then for 1.2 s of being looked at
        nudgeTimer = setInterval(() => {
          if (state.engaged || state.nudged) return clearInterval(nudgeTimer)
          if (state.laptop.ready && performance.now() - since > 1200) { state.nudged = true; duo.dataset.nudged = 'laptop'; clearInterval(nudgeTimer); post('laptop', 'renplay-embed:nudge') }
        }, 300)
      }
    }
  }, { threshold: .35 })
  view.observe(duo)

  const echo = { from: '', at: 0 }
  // A frame that has not said ready has no page of the demo to hear it, and the browser reports a message sent to one.
  const post = (name, type) => { if (state[name].ready) frames[name].contentWindow?.postMessage({ type }, DEMO) }

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
      }
    } else if (m.type === 'renplay-embed:saved') {
      // the other frame reports the same save back once it has refreshed: that is an echo, not a second save
      if (echo.from && echo.from !== name && Date.now() - echo.at < 5000) return
      echo.from = name; echo.at = Date.now()
      const other = name === 'laptop' ? 'phone' : 'laptop'
      post(other, 'renplay-embed:refresh')
      duo.classList.add('flash'); setTimeout(() => duo.classList.remove('flash'), 1600)
      if (m.label) liveText.textContent = name === 'laptop' ? 'Saved. Look at the phone.' : 'Saved on the phone. The laptop has it.'
    }
  })

  /* ---- coming back from the demo in its own tab, or from the tab being hidden: the frames ask the library again */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && loaded) for (const n of Object.keys(frames)) post(n, 'renplay-embed:refresh') })
  // a window that grows past a phone's width gets the frames, once the section is near
  narrow.addEventListener('change', () => { fit(); if (!narrow.matches) io.observe(duo) })
}

demoInit()
})()
