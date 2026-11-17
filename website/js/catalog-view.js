// What the catalog draws, as strings. The browser (js/catalog.js) and the build (build.mjs, which writes the game pages,
// the shelf on the home page and the first screen of /catalog) both import this file, so the page and its prerendered
// first screen are the same markup.
export const BASE = 'https://catalog.renplay.org/'
export const REPO = 'https://github.com/renplay-org/catalog'
export const LINKS = { itch: 'Itch.io', steam: 'Steam', patreon: 'Patreon', subscribestar: 'SubscribeStar', website: 'Website', f95: 'F95zone', discord: 'Discord', walkthrough: 'Guide' }
export const STORES = ['itch', 'steam', 'patreon', 'subscribestar', 'website']
// Engines by the names players know from F95zone.
const ENGINES = { renpy: 'Ren’Py', html: 'HTML' }
export const STATES = ['ongoing', 'completed', 'on-hold', 'abandoned']
/** Play and story tags that two or more games share become filter chips, this many before More. */
export const MAX_CHIPS = 8

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const gb = (n) => (n ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB` : '')
export const day = (d) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
export const stateLabel = (s) => cap(String(s).replace(/[-_]/g, ' '))
/** The newest release that works, the one to recommend. */
export const working = (g) => (g.releases ?? []).find((r) => r.status === 'verified' || r.status === 'playable')
/** A game is listed when its newest release is not broken and one of its releases works. */
export const offered = (g) => g.releases?.[0]?.status !== 'broken' && working(g)
/** Tag ids to show: the vocabulary's labels, without the adult content group. */
export const shownTags = (g, vocab) => (g.tagIds ?? []).filter((t) => vocab[t] && vocab[t].group !== 'content')
export const tagLabel = (vocab, t) => vocab[t]?.label ?? t
/** The poster: the recipe's default grid picture, else its first grid, else any picture (catalog schema 4). */
export const poster = (g) => (g.art ?? []).find((a) => a.kind === 'grid' && a.default) ?? (g.art ?? []).find((a) => a.kind === 'grid') ?? (g.art ?? [])[0]
export const coverUrl = (g) => { const p = poster(g); return p?.url ? new URL(p.url, BASE).href : '' }
export const gamePath = (g) => `/catalog/${g.id}/`
/** The colour the art is lit by: the poster's own tint, or nothing (the design's default tint then lights the card). */
export const tintOf = (g) => { const t = poster(g)?.tint ?? ''; return /^#[0-9a-f]{3,8}$/i.test(t) ? t : '' }
/** A cover of another shape than 2 to 3 is shown whole on its own colour, as the app does. */
export const isWhole = (g) => { const p = poster(g); return !!(p?.width && p?.height && Math.abs(p.width / p.height - 2 / 3) > 0.04) }
export const store = (g) => STORES.find((k) => /^https?:\/\//i.test(g.links?.[k] ?? ''))
/** Parts joined with a dot. */
const dots = (parts) => parts.filter(Boolean).join(' · ')

/**
 * A cover. `blur` is a hidden adult cover's ThumbHash as a data address, drawn as Renplay draws it at Blurred:
 * a soft blur of its colours, never the picture. `hidden` without a blur is a title card.
 */
export function art(g, { hidden = false, blur = '', eager = false, alt = '' } = {}) {
  const cover = coverUrl(g)
  if (hidden && blur) return `<div class="cover blurred"><img src="${blur}" alt="" width="32" height="48"><div class="tile-title">${esc(g.title)}</div><span class="tag18">18+</span></div>`
  if (!cover || hidden) return `<div class="cover"><div class="tile-title">${esc(g.title)}</div>${g.nsfw ? '<span class="tag18">18+</span>' : ''}</div>`
  const p = poster(g)
  return `<div class="cover${isWhole(g) ? ' whole' : ''}"><img src="${esc(cover)}" alt="${esc(alt)}"${p?.width && p?.height ? ` width="${p.width}" height="${p.height}"` : ''}${eager ? '' : ' loading="lazy"'} referrerpolicy="no-referrer" draggable="false">${g.nsfw ? '<span class="tag18">18+</span>' : ''}</div>`
}

/** A grid card: a link to the game's page, or (in the adult catalog) a button that opens its sheet. */
export function card(g, { link, ...cover }) {
  const tint = tintOf(g)
  const inner = `${art(g, { ...cover, alt: cover.hidden ? '' : `${g.title} cover` })}
      <h3>${esc(g.title)}</h3>
      <small class="meta">${dots([g.developer && esc(g.developer), g.state && esc(stateLabel(g.state)), g.free === false && 'Paid'])}</small>`
  const style = tint ? ` style="--tint:${tint}" data-tint="${tint}"` : ''
  return link
    ? `<div class="card"${style}><a class="game" href="${gamePath(g)}" draggable="false">${inner}</a></div>`
    : `<div class="card"${style}><button class="game card-btn" type="button" data-id="${esc(g.id)}">${inner}</button></div>`
}

/** The placeholder of a card that has not arrived: the same size, so nothing moves when it does. */
export const skeleton = (n) => '<div class="card skel" aria-hidden="true"><div class="cover"></div><h3>&nbsp;</h3><small class="meta">&nbsp;</small></div>'.repeat(n)

/** The three steps of playing a game in Renplay, with the game's own download in the first. */
export function howTo(g) {
  const file = working(g)?.archives?.[0]
  const from = store(g) ? LINKS[store(g)] : 'the developer'
  return `<ol class="how">
          <li><span>Download ${file ? `<b>${esc(file.name)}</b>` : 'the PC version'} from ${from}.</span></li>
          <li><span>In Renplay, open <b>Add games</b> and upload it, or copy it into your archives folder.</span></li>
          <li><span>Press <b>Install</b>. Renplay recognizes the download and uses the art and settings from here.</span></li>
        </ol>`
}

/** The versions of a game, each with its download and what the test found. */
export const releasesList = (g) => (g.releases ?? []).map((r) => `<div class="rel">
        <div class="top"><b>${esc(r.version)}</b>${r.status === 'broken' ? '<span class="st broken">Does not work</span>' : ''}${r.date ? `<span class="when">${day(r.date)}</span>` : ''}</div>
        ${(r.archives ?? []).map((a) => `<div class="file">${esc(a.name)}${a.size ? ` · ${gb(a.size)}` : ''}</div>`).join('')}
        ${r.verified?.notes ? `<div class="notes">${esc(r.verified.notes)}</div>` : ''}
      </div>`).join('')

/** The by-line, the summary, the tags and where to get the game: the top of a game's page and of its sheet. */
function headline(g, vocab, { heading }) {
  const tags = shownTags(g, vocab)
  const links = Object.keys(LINKS).filter((k) => /^https?:\/\//i.test(g.links?.[k] ?? ''))
  const main = store(g)
  return `<${heading}>${esc(g.title)}</${heading}>
        <p class="by">${[g.developer && `By ${esc(g.developer)}`, g.state && esc(stateLabel(g.state)), ENGINES[g.engine ?? 'renpy'] ?? esc(g.engine), g.free === false && 'Paid'].filter(Boolean).join(' · ')}</p>
        ${g.summary ? `<p class="summary">${esc(g.summary)}</p>` : ''}
        ${tags.length ? `<div class="chips">${tags.map((t) => `<span>${esc(tagLabel(vocab, t))}</span>`).join('')}</div>` : ''}
        <div class="actions-row">
          ${main ? `<a class="btn primary" href="${esc(g.links[main])}" target="_blank" rel="noopener">Get it on ${LINKS[main]}</a>` : ''}
          ${links.filter((k) => k !== main).map((k) => `<a class="btn" href="${esc(g.links[k])}" target="_blank" rel="noopener">${LINKS[k]}</a>`).join('')}
        </div>`
}

/** What is known about the game that only its page has: who, what state, the version that works and when it was tested. */
export function facts(g) {
  const rel = working(g)
  const file = rel?.archives?.[0]
  const rows = [
    ['Developer', g.developer], ['State', g.state && stateLabel(g.state)], ['Engine', ENGINES[g.engine ?? 'renpy'] ?? g.engine], ['Price', g.free === false ? 'Paid' : 'Free'],
    rel && ['Newest working version', [rel.version, day(rel.date)].filter(Boolean).join(' · ')],
    file && ['Download', [file.name, gb(file.size)].filter(Boolean).join(' · ')],
    rel?.verified?.date && ['Last tested in Renplay', [rel.verified.renplay && `Renplay ${rel.verified.renplay}`, day(rel.verified.date)].filter(Boolean).join(' on ')],
  ].filter((r) => r && r[1])
  return `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
}

/** A game's sheet: the dialog of the adult catalog. (A game's own page is built by build.mjs from the same parts.) */
export function detail(g, vocab, cover = {}) {
  return `<div class="dlg-body sheet">
      <div class="sheet-cover card" style="--tint:${tintOf(g) || 'var(--tint-default)'}">${art(g, { ...cover, eager: true, alt: cover.hidden ? '' : `${g.title} cover` })}</div>
      <div>
        ${headline(g, vocab, { heading: 'h2' })}
        <h3 class="sub-h">Play it in Renplay</h3>
        ${howTo(g)}
        <h3 class="sub-h">Versions</h3>
        <div class="releases">${releasesList(g)}</div>
        <a class="recipe-link" href="${REPO}/blob/main/recipes/${esc(g.id)}.yaml" target="_blank" rel="noopener">View the recipe on GitHub</a>
      </div>
    </div>`
}
export { headline }

/** The games a view shows: the state and tags chosen, and the words searched for. */
export function filter(games, vocab, { q = '', state = '', tags = [] }) {
  const needle = q.trim().toLowerCase()
  return games.filter((g) =>
    (!state || g.state === state) &&
    tags.every((t) => g.tagIds?.includes(t)) &&
    (!needle || [g.title, g.developer, ...shownTags(g, vocab).map((t) => tagLabel(vocab, t))].some((s) => s && s.toLowerCase().includes(needle))))
}

const pressed = (on) => `aria-pressed="${on}"`

/** The state chips and the tag chips of a view, from the games it could show. Chosen ones that no longer exist are dropped from `ui`. */
export function chips(base, vocab, ui) {
  // State filter: only states that have games in this view.
  const present = STATES.filter((s) => base.some((g) => g.state === s))
  if (ui.state && !present.includes(ui.state)) ui.state = ''
  const states = present.length > 1
    ? [['', 'Any state'], ...present.map((s) => [s, stateLabel(s)])].map(([v, l]) => `<button class="chip-btn" type="button" data-state="${v}" ${pressed(ui.state === v)}>${l}</button>`).join('')
    : ''
  // Tag chips: play and story tags that two or more games share.
  const count = {}
  for (const g of base) for (const t of shownTags(g, vocab)) if (['play', 'story'].includes(vocab[t].group)) count[t] = (count[t] ?? 0) + 1
  const common = Object.keys(count).filter((t) => count[t] >= 2).sort((a, b) => count[b] - count[a] || tagLabel(vocab, a).localeCompare(tagLabel(vocab, b)))
  ui.tags = ui.tags.filter((t) => common.includes(t))
  const shown = ui.moreTags ? common : common.slice(0, MAX_CHIPS)
  const tags = shown.map((t) => `<button class="chip-btn" type="button" data-tag="${esc(t)}" ${pressed(ui.tags.includes(t))}>${esc(tagLabel(vocab, t))}</button>`).join('')
    + (common.length > MAX_CHIPS ? `<button class="chip-btn" type="button" data-more-tags>${ui.moreTags ? 'Fewer' : 'More'}</button>` : '')
  return { states, tags }
}

export const countText = (n) => `${n} ${n === 1 ? 'game' : 'games'}`
