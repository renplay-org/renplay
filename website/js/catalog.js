// The catalog page, for renplay.org (safe for work, cards link to game pages) and adult.renplay.org (the age question
// first, every game, a sheet per game). The build sets the mode on <html data-mode>, never the host.
import { BASE, REPO, STATES, card, chips, countText, detail, filter, gamePath, offered, poster, skeleton } from './catalog-view.js'

const html = document.documentElement
const ADULT = html.dataset.mode === 'adult'
// The lawyer switch: a build that never shows an adult cover.
const NEVER = html.dataset.covers === 'never'
const AGE = 'renplay-adult:18'
const KEY = `renplay-catalog:${html.dataset.mode}`
const ROWS = 3
const $ = (id) => document.getElementById(id)
const $games = $('games'), $q = $('q')
let games = [], vocab = {}
// Covers of adult games stay hidden until asked, per visit.
const ui = { covers: false, state: '', tags: [], moreTags: false }
let thumb = null

const columns = () => getComputedStyle($games).gridTemplateColumns.split(' ').length
const hides = (g) => g.nsfw && (NEVER || !ui.covers)
/** A hidden adult cover is its ThumbHash, decoded: a soft blur of its colours. */
const blurOf = (g) => {
  const p = poster(g)
  try { return p?.thumbhash && thumb ? thumb(Uint8Array.from(atob(p.thumbhash), (c) => c.charCodeAt(0))) : '' } catch { return '' }
}
const draw = (g, i) => card(g, { link: !ADULT, hidden: hides(g), blur: hides(g) ? blurOf(g) : '', eager: i < 4 })
const view = () => filter(ADULT ? games : games.filter((g) => !g.nsfw), vocab, { q: $q.value, state: ui.state, tags: ui.tags })
const base = () => (ADULT ? games : games.filter((g) => !g.nsfw))
const shownCount = () => $games.querySelectorAll('.game:not(.skel)').length

/** Draw the filters and the first `limit` cards of the view, rounded up to whole rows. */
function render(limit) {
  const all = base()
  const { states, tags } = chips(all, vocab, ui)
  $('states').innerHTML = states
  $('tags').innerHTML = tags
  $('tags').classList.toggle('open', ui.moreTags)
  const shown = view()
  const cols = columns()
  const n = Math.min(shown.length, Math.ceil(limit / cols) * cols)
  $('count').textContent = countText(shown.length)
  $games.innerHTML = n ? shown.slice(0, n).map(draw).join('') : `<div class="empty">No games match. <a href="#" data-request>Request one</a>.</div>`
  const covers = $('covers')
  if (covers) {
    covers.hidden = NEVER || !(all.some((g) => g.nsfw))
    covers.textContent = ui.covers ? 'Hide covers' : 'Show covers'
  }
  watch()
}
/** A batch is a few whole rows at the width of the screen, so no row stays half full until the end of the list. */
const batch = () => columns() * ROWS
const first = () => Math.max(batch(), Math.ceil(24 / columns()) * columns())
const reset = () => render(first())

/** More cards, as the visitor nears the end of the list. */
function more() {
  const shown = view(), have = shownCount()
  if (!shown.length || have >= shown.length) return
  const n = Math.min(shown.length, Math.ceil((have + batch()) / columns()) * columns())
  $games.insertAdjacentHTML('beforeend', shown.slice(have, n).map((g, i) => draw(g, have + i)).join(''))
  watch()
}
const end = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more() }, { rootMargin: '1400px 0px' })
/** Look again at the end of the list: the observer only speaks when it changes, and a batch can leave it in view. */
function watch() { end.unobserve($('end')); end.observe($('end')) }

// Going to a game and coming back returns to the same place: the cards shown and the scroll, kept for the tab.
const save = () => {
  if (!games.length) return
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ scroll: scrollY, shown: shownCount(), q: $q.value, state: ui.state, tags: ui.tags, moreTags: ui.moreTags }))
  } catch {}
}
function restore(index) {
  let saved
  try { saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') } catch {}
  if (!saved || !index) return false
  $q.value = saved.q ?? ''
  // Adult covers are hidden again on every visit, so they are not kept.
  Object.assign(ui, { state: saved.state ?? '', tags: saved.tags ?? [], moreTags: !!saved.moreTags })
  render(saved.shown || first())
  // At once: the page's smooth scrolling would show the list sliding to its place.
  scrollTo({ top: saved.scroll || 0, behavior: 'instant' })
  return true
}
history.scrollRestoration = 'manual'
addEventListener('pagehide', save)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save() })
let saving = 0
addEventListener('scroll', () => { clearTimeout(saving); saving = setTimeout(save, 250) }, { passive: true })
document.addEventListener('click', (e) => { if (e.target.closest('a.game')) save() })

const open = (g) => { $('detail-body').innerHTML = detail(g, vocab, { hidden: hides(g), blur: hides(g) ? blurOf(g) : '' }); $('detail').showModal() }
let opened = null
const REQUESTS = ['request']

function load(idx) {
  vocab = idx.vocabulary ?? {}
  // Only games that work are listed: one whose newest release is broken stays in the index, not here.
  games = (idx.games ?? []).filter(offered).sort((a, b) => a.title.localeCompare(b.title))
}

function hashed() {
  const id = decodeURIComponent(location.hash.slice(1))
  if (!id || REQUESTS.includes(id)) return
  const g = games.find((x) => x.id === id)
  if (ADULT) { if (g) { opened = g; open(g) } return }
  // A game that is not here is in the adult catalog.
  if (g && !g.nsfw) location.replace(gamePath(g))
  else $('hash-note').hidden = false
}

async function start() {
  if (ADULT) {
    thumb = (await import('./thumbhash.js')).thumbHashToDataURL
    $games.innerHTML = skeleton(columns() * ROWS)
  }
  let cached = null
  try { cached = JSON.parse(sessionStorage.getItem(`${KEY}:index`) ?? 'null') } catch {}
  if (cached) {
    load(cached)
    if (restore(cached)) { html.classList.remove('restoring'); wire(); hashed(); return }
  }
  html.classList.remove('restoring')
  try {
    const idx = await (await fetch(BASE + (ADULT ? 'index.v4.json' : 'index.v4.sfw.json'))).json()
    try { sessionStorage.setItem(`${KEY}:index`, JSON.stringify({ vocabulary: idx.vocabulary, games: (idx.games ?? []).filter(offered) })) } catch {}
    load(idx)
  } catch {
    if (!$games.dataset.prerendered) $games.innerHTML = `<div class="empty">The catalog could not be loaded. It is also on <a href="${REPO}">GitHub</a>.</div>`
    return
  }
  // The first screen of the safe-for-work page came with the page: keep it, and only wire it up.
  if (ADULT || !$games.dataset.prerendered) reset()
  else watch()
  wire()
  hashed()
}

function wire() {
  addEventListener('hashchange', hashed)
  $q.addEventListener('input', reset)
  $('states').addEventListener('click', (e) => {
    const b = e.target.closest('[data-state]')
    if (b && STATES.concat('').includes(b.dataset.state)) { ui.state = b.dataset.state; reset() }
  })
  $('tags').addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if ('moreTags' in b.dataset) ui.moreTags = !ui.moreTags
    else if (b.dataset.tag) ui.tags = ui.tags.includes(b.dataset.tag) ? ui.tags.filter((t) => t !== b.dataset.tag) : [...ui.tags, b.dataset.tag]
    reset()
  })
  $('covers')?.addEventListener('click', () => { ui.covers = !ui.covers; render(Math.max(shownCount(), first())) })
  if (ADULT) {
    $games.addEventListener('click', (e) => {
      const b = e.target.closest('.game')
      const g = b && games.find((x) => x.id === b.dataset.id)
      if (g) { opened = g; open(g); if (e.detail) document.activeElement?.blur() }
    })
  }
}

// Dialogs.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-request]')) { e.preventDefault(); $('request').showModal(); $('request').querySelector('input').focus() }
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close()
})
// Click outside a dialog closes it.
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close() }))
if (location.hash === '#request') $('request').showModal()
// Hand the request over to GitHub's form, filled in.
$('req-form').addEventListener('submit', (e) => {
  e.preventDefault()
  const f = new FormData(e.target)
  const u = new URL(REPO + '/issues/new')
  u.searchParams.set('template', 'request-game.yml')
  u.searchParams.set('title', `Request: ${f.get('game')}${f.get('version') ? ` ${f.get('version')}` : ''}`)
  for (const k of ['game', 'version', 'page']) if (f.get(k)) u.searchParams.set(k, f.get(k))
  window.open(u, '_blank', 'noopener')
  $('request').close()
})

if (ADULT) {
  // Nothing from the index is fetched before Yes, and Yes is kept on this host.
  const go = () => { html.setAttribute('data-ok', ''); start() }
  if (html.hasAttribute('data-ok')) go()
  else $('yes').addEventListener('click', () => { try { localStorage.setItem(AGE, '1') } catch {} go() })
} else start()
