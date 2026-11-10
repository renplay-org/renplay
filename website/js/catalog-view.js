// What the catalog draws, as strings. The browser (js/catalog.js) and the build (build.mjs, which writes the game pages
// and the first screen of /catalog) both import this file, so the page and its prerendered first screen are the same markup.
export const BASE = 'https://catalog.renplay.org/'
export const REPO = 'https://github.com/renplay-org/catalog'
export const LINKS = { itch: 'Itch.io', steam: 'Steam', patreon: 'Patreon', subscribestar: 'SubscribeStar', website: 'Website', f95: 'F95zone', discord: 'Discord', walkthrough: 'Guide' }
const STORES = ['itch', 'steam', 'patreon', 'subscribestar', 'website']
// Engines by the names players know from F95zone.
const ENGINES = { renpy: 'Ren’Py', html: 'HTML' }
export const STATES = ['ongoing', 'completed', 'on-hold', 'abandoned']
/** Play and story tags that two or more games share become filter chips, this many before More. */
export const MAX_CHIPS = 8

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)
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
/** Parts joined with a dot that never wraps away from the part after it. */
const dots = (parts) => parts.filter(Boolean).map((x, i) => `<span style="white-space:nowrap">${i ? '· ' : ''}${x}</span>`).join(' ')

/**
 * A cover. `blur` is a hidden adult cover's ThumbHash as a data address, drawn as Renplay draws it at Blurred:
 * a soft blur of its colours, never the picture. `hidden` without a blur is a coloured title card.
 */
export function art(g, { hidden = false, blur = '', eager = false, alt = '' } = {}) {
  const cover = coverUrl(g)
  if (hidden && blur) return `<div class="art blurred"><img src="${blur}" alt=""><div class="tile-title">${esc(g.title)}</div><span class="tag18">18+</span></div>`
  if (!cover || hidden) {
    const h = hue(g.title)
    return `<div class="art"><div class="tile-title" style="background:radial-gradient(130% 120% at 0% 0%, hsl(${h} 45% 34%), hsl(${(h + 35) % 360} 40% 16%) 55%, hsl(${(h + 60) % 360} 30% 8%))">${esc(g.title)}</div>${g.nsfw ? '<span class="tag18">18+</span>' : ''}</div>`
  }
  const p = poster(g)
  // A cover of another shape is shown whole on its own colour, as the app does.
  const whole = p?.width && p?.height && Math.abs(p.width / p.height - 2 / 3) > 0.04
  const tint = /^#[0-9a-f]{3,8}$/i.test(p?.tint ?? '') ? p.tint : ''
  return `<div class="art"${whole && tint ? ` style="background:radial-gradient(120% 90% at 50% 40%, ${tint}, #0a0a0f)"` : ''}><img src="${esc(cover)}" alt="${esc(alt)}"${p?.width && p?.height ? ` width="${p.width}" height="${p.height}"` : ''}${eager ? '' : ' loading="lazy"'} referrerpolicy="no-referrer"${whole ? ' class="whole"' : ''}>${g.nsfw ? '<span class="tag18">18+</span>' : ''}</div>`
}

/** A grid card: a link to the game's page, or (in the adult catalog) a button that opens its sheet. */
export function card(g, { link, ...cover }) {
  const inner = `${art(g, cover)}
      <h3>${esc(g.title)}</h3>
      <div class="meta">${dots([g.developer && esc(g.developer), g.state && esc(stateLabel(g.state)), g.free === false && '<span class="paid">Paid</span>'])}</div>`
  return link ? `<a class="game" href="${gamePath(g)}">${inner}</a>` : `<button class="game" data-id="${esc(g.id)}">${inner}</button>`
}

/** The placeholder of a card that has not arrived: the same size, so nothing moves when it does. */
export const skeleton = (n) => '<div class="game skel" aria-hidden="true"><div class="art"></div><h3>&nbsp;</h3><div class="meta">&nbsp;</div></div>'.repeat(n)

/** A game's sheet: the dialog in the adult catalog and the body of a game page (`heading` is h1 there). */
export function detail(g, vocab, { heading = 'h2', ...cover } = {}) {
  const rel = working(g)
  // Only web addresses become links: a recipe's link is never a script.
  const links = Object.keys(LINKS).filter((k) => /^https?:\/\//i.test(g.links?.[k] ?? ''))
  const store = STORES.find((k) => links.includes(k))
  const file = rel?.archives?.[0]
  const releases = (g.releases ?? []).map((r) => `<div class="rel">
        <div class="top"><b>${esc(r.version)}</b>${r.status === 'broken' ? '<span class="st broken">Does not work</span>' : ''}${r.date ? `<span class="when">${day(r.date)}</span>` : ''}</div>
        ${(r.archives ?? []).map((a) => `<div class="file">${esc(a.name)}${a.size ? ` · ${gb(a.size)}` : ''}</div>`).join('')}
        ${r.verified?.notes ? `<div class="notes">${esc(r.verified.notes)}</div>` : ''}
      </div>`).join('')
  const tags = shownTags(g, vocab)
  return `<div class="sheet">
      <div>${art(g, { ...cover, alt: `${g.title} cover` })}</div>
      <div>
        <${heading}>${esc(g.title)}</${heading}>
        <div class="by">${[g.developer && `By ${esc(g.developer)}`, g.state && esc(stateLabel(g.state)), ENGINES[g.engine ?? 'renpy'] ?? esc(g.engine), g.free === false && '<span class="paid">Paid</span>'].filter(Boolean).join(' · ')}</div>
        ${g.summary ? `<p class="summary">${esc(g.summary)}</p>` : ''}
        ${tags.length ? `<div class="chips">${tags.map((t) => `<span>${esc(tagLabel(vocab, t))}</span>`).join('')}</div>` : ''}
        <div class="actions-row">
          ${store ? `<a class="btn primary sm" href="${esc(g.links[store])}" target="_blank" rel="noopener">Get it on ${LINKS[store]}</a>` : ''}
          ${links.filter((k) => k !== store).map((k) => `<a class="btn sm" href="${esc(g.links[k])}" target="_blank" rel="noopener">${LINKS[k]}</a>`).join('')}
        </div>
        <h${heading === 'h1' ? 2 : 3} class="sub-h">Play it in Renplay</h${heading === 'h1' ? 2 : 3}>
        <ol class="how">
          <li><span>Download ${file ? `<b>${esc(file.name)}</b>` : 'the PC version'} from ${store ? LINKS[store] : 'the developer'}.</span></li>
          <li><span>In Renplay, open <b>Add games</b> and upload it, or copy it into your archives folder.</span></li>
          <li><span>Press <b>Install</b>. Renplay recognizes the download and uses the art and settings from here.</span></li>
        </ol>
        <h${heading === 'h1' ? 2 : 3} class="sub-h">Versions</h${heading === 'h1' ? 2 : 3}>
        <div class="releases">${releases}</div>
        <a class="recipe-link" href="${REPO}/blob/main/recipes/${esc(g.id)}.yaml" target="_blank" rel="noopener">View the recipe on GitHub</a>
      </div>
    </div>`
}

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
