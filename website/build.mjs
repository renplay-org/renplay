#!/usr/bin/env node
// Builds the website into dist/ (renplay.org) and dist-adult/ (adult.renplay.org): `sh build.sh`.
//
// Both come from the same sources. The catalog's safe-for-work index (https://catalog.renplay.org/index.v4.sfw.json, or the
// file in CATALOG_INDEX_FILE) gives renplay.org a page for each game, the shelf on the home page and the first screen of
// /catalog. The adult catalog is the same page with its mode set at build time (never by hostname), and it reads the full
// index in the browser, after the visitor says they are 18 or older. NEVER_SHOW_ADULT_COVERS=1 builds it with its covers
// always blurred. Each page's social card is made here too (lib/og.mjs), with the game's cover fetched once.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LINKS, card, chips, countText, coverUrl, esc, facts, gamePath, headline, howTo, isWhole, offered, poster, releasesList, REPO, shownTags, store, tagLabel, tintOf, working } from './js/catalog-view.js'
import { CARD, fetchCover, gameCard, homeCard } from './lib/og.mjs'
import { cut, head, json, read, render } from './lib/render.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const SITE = 'https://renplay.org'
const INDEX_URL = 'https://catalog.renplay.org/index.v4.sfw.json'
const neverCovers = ['1', 'true'].includes(process.env.NEVER_SHOW_ADULT_COVERS ?? '')
const FIRST = 24
// The one sentence that says what Renplay is. It is the home page's description and its first screen's lede, the docs' and the readme's.
const DEFINITION = 'Renplay is a self-hosted player for Ren’Py games in the browser, with saves on your own server.'
// Games with strong official art, shown on the home page's shelf in this order. A game that has left the catalog is replaced by the next one.
const SHELF = ['butterfly-soup', 'charm-studies', 'cryptid-crush', 'dawn-chorus', 'dear-devere', 'first-kiss-at-a-spooky-soiree', 'hydrangea', 'inversed', 'starry-flowers', 'stillwater', 'text-your-life', 'your-dry-delight']
// Pages the website has besides the home page, the catalog and the games. The answer pages are added here, so the sitemap and the nav have room for them.
const PAGES = []

const write = (dir, path, text) => {
  mkdirSync(dirname(join(root, dir, path)), { recursive: true })
  writeFileSync(join(root, dir, path), text)
}

async function loadIndex() {
  if (process.env.CATALOG_INDEX_FILE) return JSON.parse(readFileSync(process.env.CATALOG_INDEX_FILE, 'utf8'))
  let last
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(INDEX_URL)
      if (!res.ok) throw new Error(`${INDEX_URL} answered ${res.status}`)
      return await res.json()
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, attempt * 1500))
    }
  }
  throw new Error(`The safe-for-work catalog could not be fetched: ${last.message}. Set CATALOG_INDEX_FILE to build from a file.`)
}

const FOOTNOTE_HOME = 'Renplay is free and open source (MIT), made by the Renplay Team. It is not affiliated with Ren’Py, which is © Tom Rothamel and contributors. Games and their art belong to their developers.'
const FOOTNOTE_CATALOG = 'Renplay and its catalog are made by the Renplay Team. Covers are linked from where the catalog found them, such as the developers’ pages, Steam and SteamGridDB, and belong to their makers. The catalog never hosts game files: get games from their developers.'

const idx = await loadIndex()
const vocab = idx.vocabulary ?? {}
const updated = String(idx.generated ?? new Date().toISOString()).slice(0, 10)
// The safe-for-work index has no adult game. The page never trusts that alone.
const games = (idx.games ?? []).filter((g) => !g.nsfw && offered(g)).sort((a, b) => a.title.localeCompare(b.title))
if (games.length < 10) throw new Error(`Only ${games.length} games in the catalog index: not building the website from it`)
if (games.some((g) => !/^[a-z0-9][a-z0-9-]*$/.test(g.id) || g.id === 'request')) throw new Error('A game id is not a safe page name')

const here = (site) => ({ site, catalogCurrent: '' })
const inCatalog = (site) => ({ site, catalogCurrent: ' aria-current="page"' })

/** What the pages take from design/ (Lamplight's tokens, fonts, grain and the wordmark), at /design/, and the mark as /logo.svg. */
function copyDesign(out) {
  for (const f of ['tokens.css', 'fonts.css', 'fonts', 'grain.webp', 'logo/wordmark.svg']) cpSync(join(root, '../design', f), join(root, out, 'design', f), { recursive: true })
  cpSync(join(root, '../design/logo/mark.svg'), join(root, out, 'logo.svg'))
}
const COMMON = ['site.css', 'catalog.css', 'favicon.ico', 'favicon-48.png', 'apple-touch-icon.png', 'NOTICE']
const SHARED_JS = ['shared.js', 'room-data.js', 'room.js']

// ---- renplay.org ----------------------------------------------------------------------------------------------------
const OUT = 'dist'
rmSync(join(root, OUT), { recursive: true, force: true })
rmSync(join(root, 'dist-adult'), { recursive: true, force: true })
for (const f of [...COMMON, 'home.css', 'logo.png', 'img', '_redirects', '_headers']) cpSync(join(root, f), join(root, OUT, f), { recursive: true })
for (const f of [...SHARED_JS, 'home.js', 'catalog.js', 'catalog-view.js', 'thumbhash.js']) cpSync(join(root, 'js', f), join(root, OUT, 'js', f))
cpSync(join(root, '../LICENSE'), join(root, OUT, 'LICENSE'))
copyDesign(OUT)

// The social cards: one for the home page, one for each game.
const cardOf = (name) => `${SITE}/og/${name}.jpg`
write(OUT, 'og/home.jpg', await homeCard({ room: join(root, 'img/room/room-wide.webp'), tagline: 'Your Ren’Py games, on every screen.', line: 'Free, open source, self-hosted.' }))
const OG_HOME = { image: cardOf('home'), imageAlt: 'Renplay: your Ren’Py games, on every screen', imageSize: CARD }

const software = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Renplay',
  url: `${SITE}/`,
  description: DEFINITION,
  applicationCategory: 'GameApplication',
  applicationSubCategory: 'Visual novel player',
  operatingSystem: 'Any system that runs Docker; plays in any modern web browser',
  image: `${SITE}/logo.png`,
  license: 'https://opensource.org/license/mit',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  softwareHelp: 'https://docs.renplay.org/',
  sameAs: ['https://github.com/renplay-org/renplay', 'https://hub.docker.com/r/renplay/renplay'],
}
const website = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Renplay', alternateName: 'Renplay self-hosted Ren’Py player', url: `${SITE}/` }
const organization = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Renplay', url: `${SITE}/`, logo: `${SITE}/logo.png`, sameAs: ['https://github.com/renplay-org/renplay', 'https://hub.docker.com/r/renplay/renplay'] }

// The shelf: the games above that are in the catalog, then others to fill it, each with the cover the catalog gives it.
const withCover = (g) => !!coverUrl(g) && poster(g)?.width && poster(g)?.height
const picked = SHELF.map((id) => games.find((g) => g.id === id)).filter((g) => g && withCover(g))
const shelf = [...picked, ...games.filter((g) => withCover(g) && !picked.includes(g))].slice(0, SHELF.length)
const asItem = (html) => html.replace(/^<div class="card"/, '<li class="card"').replace(/<\/div>$/, '</li>')
write(OUT, 'index.html', render(read('index.html'), {
  modes: ['sfw'],
  ...here(''),
  definition: DEFINITION,
  count: String(games.length),
  shelfLabel: String(shelf.length),
  shelf: shelf.map((g) => `      ${asItem(card(g, { link: true }))}`).join('\n'),
  footnote: FOOTNOTE_HOME,
  head: head({
    title: 'Renplay: a self-hosted Ren’Py player for your browser and phone',
    description: DEFINITION,
    canonical: `${SITE}/`,
    css: ['/home.css'],
    ...OG_HOME,
    preloads: [
      // The room is the largest thing on the first screen. Exactly one of the two answers a viewport, even a square one.
      '<link rel="preload" as="image" type="image/avif" href="/img/room/room-tall.avif" imagesrcset="/img/room/room-tall.avif" imagesizes="100vw" media="(max-aspect-ratio: 1/1)" fetchpriority="high">',
      '<link rel="preload" as="image" type="image/avif" href="/img/room/room-wide.avif" imagesrcset="/img/room/room-wide.avif 1600w, /img/room/room-wide-1200.avif 1200w" imagesizes="100vw" media="(min-aspect-ratio: 10001/10000)" fetchpriority="high">',
    ],
    extra: [software, website, organization].map(json).join('\n'),
  }),
}))

// ---- the catalog ----------------------------------------------------------------------------------------------------
const listing = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Renplay catalog',
  url: `${SITE}/catalog/`,
  mainEntity: { '@type': 'ItemList', itemListElement: games.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.title, url: `${SITE}${gamePath(g)}` })) },
}
const filters = chips(games, vocab, { state: '', tags: [], moreTags: false })
write(OUT, 'catalog/index.html', render(read('pages/catalog.html'), {
  modes: ['sfw'],
  ...inCatalog(''),
  mode: 'sfw',
  covers: '',
  ok: ' data-ok',
  footnote: FOOTNOTE_CATALOG,
  eyebrow: 'The catalog',
  heading: 'Games that work in Renplay.',
  lead: 'Every game here was installed and played in Renplay. Get it from its developer on itch.io, Patreon or F95zone, add the download, and Renplay picks up the art and the right settings by itself. Most other Ren’Py games work too.',
  states: filters.states,
  tags: filters.tags,
  count: countText(games.length),
  games: games.slice(0, FIRST).map((g, i) => card(g, { link: true, eager: i < 4 })).join(''),
  prerendered: ' data-prerendered',
  list: games.map((g) => `<li><a href="${gamePath(g)}">${esc(g.title)}</a></li>`).join(''),
  head: head({
    title: 'Renplay catalog: Ren’Py games tested in Renplay',
    description: 'Ren’Py games tested in Renplay: where to get each one, which download works, and how to add it. Free to browse, safe for work.',
    canonical: `${SITE}/catalog/`,
    css: ['/catalog.css'],
    extra: json(listing),
    ...OG_HOME,
  }),
}))

// ---- a page for each game ---------------------------------------------------------------------------------------------
const gameTemplate = read('pages/game.html')
const warnings = []
const describe = (g) => {
  const rel = working(g)
  const tags = shownTags(g, vocab).slice(0, 3).map((t) => tagLabel(vocab, t))
  // As much as fits a search result: what the game is, then who made it and the version tested, then where to get it.
  const parts = [
    g.summary ? `${g.summary.replace(/[.!?…]+$/, '')}.` : `A visual novel${tags.length ? `: ${tags.join(', ')}` : ''}.`,
    `${g.developer ? `By ${g.developer}. ` : ''}${rel?.version ? `Version ${rel.version} works in Renplay.` : 'Tested in Renplay.'}`,
    `Get it${store(g) ? ` on ${LINKS[store(g)]}` : ' from its developer'} and play it in your browser.`,
  ]
  if (!g.summary) warnings.push(g.id)
  let text = parts[0]
  for (const part of parts.slice(1)) if (`${text} ${part}`.length <= 158) text += ` ${part}`
  return cut(text, 158)
}
const titleOf = (g) => [`${g.title} · Renplay catalog`, `${g.title} · Renplay`, g.title].find((t) => t.length <= 65) ?? cut(g.title, 65)

// The cards of every game are made side by side, a few at a time: each one fetches a cover.
const cards = new Map()
{
  let next = 0
  const work = async () => {
    while (next < games.length) {
      const g = games[next++]
      const bytes = await fetchCover(coverUrl(g))
      try {
        cards.set(g.id, await gameCard({ title: g.title, developer: g.developer, tint: tintOf(g), cover: bytes }))
      } catch {
        // A cover the image library cannot read: the card has the name without it.
        cards.set(g.id, await gameCard({ title: g.title, developer: g.developer, tint: tintOf(g), cover: null }))
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, work))
}

for (const g of games) {
  const p = poster(g)
  const cover = coverUrl(g)
  const rel = working(g)
  const url = `${SITE}${gamePath(g)}`
  const tags = shownTags(g, vocab).map((t) => tagLabel(vocab, t))
  const description = describe(g)
  write(OUT, `og/${g.id}.jpg`, cards.get(g.id))
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: g.title,
      url,
      description: g.summary || description,
      image: cardOf(g.id),
      ...(g.developer && { author: { '@type': 'Organization', name: g.developer } }),
      ...(tags.length && { genre: tags }),
      applicationCategory: 'Game',
      gamePlatform: 'Web browser, through Renplay',
      operatingSystem: 'Any system that runs Renplay',
      playMode: 'SinglePlayer',
      inLanguage: 'en',
      ...(rel?.version && { version: rel.version }),
      ...(g.free && { isAccessibleForFree: true }),
      ...(store(g) && { sameAs: [g.links[store(g)]] }),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Renplay', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Catalog', item: `${SITE}/catalog/` },
        { '@type': 'ListItem', position: 3, name: g.title, item: url },
      ],
    },
  ]
  const tint = tintOf(g)
  write(OUT, `catalog/${g.id}/index.html`, render(gameTemplate, {
    modes: ['sfw'],
    ...inCatalog(''),
    footnote: FOOTNOTE_CATALOG,
    title: esc(g.title),
    path: gamePath(g),
    bandStyle: [tint && `--tint:${tint}`, p?.avg && /^#[0-9a-f]{3,8}$/i.test(p.avg) && `--avg:${p.avg}`, cover && `--cover:url('${cover.replace(/["'()\s]/g, encodeURIComponent)}')`].filter(Boolean).join(';'),
    cover: `<div class="game-cover${isWhole(g) ? ' whole' : ''}">${cover ? `<img src="${esc(cover)}" alt="${esc(g.title)} cover" width="${p.width}" height="${p.height}" referrerpolicy="no-referrer" fetchpriority="high">` : ''}</div>`,
    headline: headline(g, vocab, { heading: 'h1' }),
    howto: howTo(g),
    releases: releasesList(g),
    recipe: `${REPO}/blob/main/recipes/${g.id}.yaml`,
    facts: facts(g),
    head: head({
      title: titleOf(g),
      description,
      canonical: url,
      css: ['/catalog.css'],
      image: cardOf(g.id),
      imageAlt: `${g.title} cover, with the name of the game`,
      imageSize: CARD,
      extra: data.map(json).join('\n'),
      preloads: cover ? [`<link rel="preload" as="image" href="${esc(cover)}" fetchpriority="high" referrerpolicy="no-referrer">`] : [],
    }),
  }))
}
if (warnings.length) console.log(`${warnings.length} games have no summary, so their description is made from their tags and tested version: ${warnings.join(', ')}`)

// ---- the 404 and what search engines read ---------------------------------------------------------------------------
const notFound = (site) => render(read('pages/404.html'), {
  modes: ['sfw'],
  ...here(site),
  footnote: FOOTNOTE_CATALOG,
  head: head({ title: 'Page not found · Renplay', description: 'This page is not here. Go to the Renplay home page or the catalog.', robots: [['robots', 'noindex']], css: ['/catalog.css'] }),
})
write(OUT, '404.html', notFound(''))
write(OUT, 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[['/', undefined], ['/catalog/', updated], ...PAGES.map((path) => [path, updated]), ...games.map((g) => [gamePath(g), updated])].map(([path, date]) => `  <url><loc>${SITE}${path}</loc>${date ? `<lastmod>${date}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`)
write(OUT, 'robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`)

// ---- adult.renplay.org ----------------------------------------------------------------------------------------------------
const ADULT_OUT = 'dist-adult'
for (const f of COMMON) cpSync(join(root, f), join(root, ADULT_OUT, f), { recursive: true })
cpSync(join(root, 'img/room'), join(root, ADULT_OUT, 'img/room'), { recursive: true })
for (const f of [...SHARED_JS, 'catalog.js', 'catalog-view.js', 'thumbhash.js']) cpSync(join(root, 'js', f), join(root, ADULT_OUT, 'js', f))
cpSync(join(root, '../LICENSE'), join(root, ADULT_OUT, 'LICENSE'))
copyDesign(ADULT_OUT)
write(ADULT_OUT, 'index.html', render(read('pages/catalog.html'), {
  modes: ['adult'],
  ...here(SITE),
  mode: 'adult',
  covers: neverCovers ? 'never' : '',
  ok: '',
  footnote: FOOTNOTE_CATALOG,
  eyebrow: 'The adult catalog',
  heading: 'Every game that works in Renplay.',
  lead: 'Safe-for-work and adult games, all installed and played in Renplay. Adult covers stay blurred until you show them. Get each game from its developer, add the download, and Renplay picks up the art and the right settings by itself.',
  states: '',
  tags: '',
  count: '',
  games: '',
  prerendered: '',
  list: '',
  head: head({
    title: 'Renplay · Adult catalog',
    description: 'Every game tested in Renplay, adult games included. For adults only.',
    robots: [['robots', 'noindex, nofollow'], ['rating', 'adult'], ['rating', 'RTA-5042-1996-1400-1577-RTA']],
    css: ['/catalog.css'],
  }),
}))
write(ADULT_OUT, '404.html', notFound(SITE))
// Crawlers are let in on purpose: a page that robots.txt blocks is never fetched, so its noindex (the header below and
// the meta of each page) is never read, and the address can still be listed. check-website.mjs keeps it so.
write(ADULT_OUT, 'robots.txt', 'User-agent: *\nAllow: /\n')
write(ADULT_OUT, '_headers', `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Robots-Tag: noindex, nofollow
`)

console.log(`Built ${games.length} game pages${neverCovers ? ', and the adult catalog with its covers always blurred' : ''}.`)
