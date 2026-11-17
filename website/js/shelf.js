/* The shelf of games on the home page: cards that lean toward the light, a drag that carries on and snaps, the colour of the card in the middle. Loaded after home.js. */
(() => {
'use strict'
const { $, $$, still, lerp } = window.Renplay
function shelfInit() {
  const shelf = $('#shelf')
  if (!shelf) return
  // every card leans toward the light (the hand), the one under it a little more
  const cardsAll = $$('.card', shelf)
  const wrapEl = shelf.parentElement
  let shelfSeen = false
  new IntersectionObserver((es) => { shelfSeen = es[0].isIntersecting }, { rootMargin: '80px' }).observe(wrapEl)
  const lean = window.Renplay.lean(() => cardsAll, { ry: 9, rx: 7 })
  if (lean) window.Renplay.onFrame(() => { if (shelfSeen) lean() })
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

shelfInit()
})()
