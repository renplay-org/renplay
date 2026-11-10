#!/usr/bin/env node
// Builds the website into dist/ (renplay.org) and dist-adult/ (adult.renplay.org): `sh build.sh`.
//
// Both come from the same sources. The catalog's safe-for-work index (https://catalog.renplay.org/index.v4.sfw.json, or the
// file in CATALOG_INDEX_FILE) gives renplay.org a page for each game and the first screen of /catalog. The adult catalog is
// the same page with its mode set at build time (never by hostname), and it reads the full index in the browser, after the
// visitor says they are 18 or older. NEVER_SHOW_ADULT_COVERS=1 builds it with its covers always blurred.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LINKS, card, chips, countText, coverUrl, detail, esc, gamePath, offered, poster, shownTags, tagLabel, working } from './js/catalog-view.js'

const root = dirname(fileURLToPath(import.meta.url))
const SITE = 'https://renplay.org'
const ADULT_SITE = 'https://adult.renplay.org'
const INDEX_URL = 'https://catalog.renplay.org/index.v4.sfw.json'
const neverCovers = ['1', 'true'].includes(process.env.NEVER_SHOW_ADULT_COVERS ?? '')
const FIRST = 24
// Free, safe-for-work games with strong official art, offered on the home page as places to start.
const STARTERS = ['butterfly-soup', 'starry-flowers', 'a-date-with-death']

const read = (path) => readFileSync(join(root, path), 'utf8')
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

/** Templates: {{name}}, {{partial}}, and <!--if mode-->…<!--else-->…<!--endif--> blocks. */
function render(template, vars) {
  const withPartials = template.replace(/\{\{(nav|footer)\}\}/g, (_, name) => read(`partials/${name}.html`))
  const blocks = withPartials.replace(/<!--if (\w+)-->([\s\S]*?)(?:<!--else-->([\s\S]*?))?<!--endif-->/g, (_, key, yes, no = '') => (vars.modes.includes(key) ? yes : no))
  return blocks.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`The template uses {{${key}}}, which the build does not set`)
    return vars[key]
  })
}

/** Cut at a word, ending with a full stop: the writing rule has no ellipses. */
const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/[\s,;:.!?]*\S*$/, '')}.`)
const json = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

/** The tags in a page's head: title, description, address, cards and icons. */
function head({ title, description, canonical, image, imageAlt, imageSize, card: twitter = 'summary_large_image', robots, css = [], extra = '' }) {
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    canonical && `<link rel="canonical" href="${esc(canonical)}">`,
    ...(robots ?? []).map(([name, content]) => `<meta name="${name}" content="${content}">`),
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Renplay">',
    '<meta property="og:locale" content="en_US">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    canonical && `<meta property="og:url" content="${esc(canonical)}">`,
    image && `<meta property="og:image" content="${esc(image)}">`,
    image && imageSize && `<meta property="og:image:width" content="${imageSize[0]}"><meta property="og:image:height" content="${imageSize[1]}">`,
    image && `<meta property="og:image:alt" content="${esc(imageAlt)}">`,
    `<meta name="twitter:card" content="${twitter}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    image && `<meta name="twitter:image" content="${esc(image)}">`,
    image && `<meta name="twitter:image:alt" content="${esc(imageAlt)}">`,
    '<meta name="theme-color" content="#0a0a0f">',
    '<link rel="icon" href="/logo.svg" type="image/svg+xml">',
    '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">',
    '<link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    ...['/site.css', ...css].map((href) => `<link rel="stylesheet" href="${href}">`),
    extra,
  ].filter(Boolean).join('\n')
}

const OG = { image: `${SITE}/img/og.jpg`, imageAlt: 'Renplay: your Ren’Py games on every screen', imageSize: [1200, 630] }
const FOOTNOTE_HOME = 'Renplay is free and open source (MIT), made by the Renplay Team. It is not affiliated with Ren’Py, which is © Tom Rothamel and contributors. Games and their art belong to their developers. The screenshots show Butterfly Soup by Brianna Lei.'
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

const starters = STARTERS.map((id) => {
  const g = games.find((x) => x.id === id)
  if (!g) throw new Error(`The home page offers ${id} as a game to start with, and the catalog has no such game that works. Change STARTERS in build.mjs.`)
  return card(g, { link: true })
}).join('')

// ---- renplay.org ----------------------------------------------------------------------------------------------------
const OUT = 'dist'
rmSync(join(root, OUT), { recursive: true, force: true })
rmSync(join(root, 'dist-adult'), { recursive: true, force: true })
for (const f of ['site.css', 'catalog.css', 'logo.svg', 'logo.png', 'favicon.ico', 'favicon-48.png', 'apple-touch-icon.png', 'img', 'js', '_redirects', '_headers', 'NOTICE']) {
  cpSync(join(root, f), join(root, OUT, f), { recursive: true })
}
cpSync(join(root, '../LICENSE'), join(root, OUT, 'LICENSE'))

const software = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Renplay',
  url: `${SITE}/`,
  description: 'Renplay is a self-hosted player for Ren’Py games in the browser, with saves on your own server.',
  applicationCategory: 'GameApplication',
  applicationSubCategory: 'Visual novel player',
  operatingSystem: 'Any system that runs Docker; plays in any modern web browser',
  image: `${SITE}/logo.png`,
  license: 'https://opensource.org/license/mit',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  softwareHelp: 'https://docs.renplay.org',
  sameAs: ['https://github.com/renplay-org/renplay'],
}
write(OUT, 'index.html', render(read('index.html'), {
  modes: ['sfw'],
  ...here(''),
  starters,
  footnote: FOOTNOTE_HOME,
  head: head({
    title: 'Renplay · Your Ren’Py games on every screen',
    description: 'Renplay is a self-hosted player for Ren’Py games in the browser, with saves on your own server.',
    canonical: `${SITE}/`,
    ...OG,
    extra: `<link rel="preload" as="image" href="/img/desktop-library.webp" type="image/webp" fetchpriority="high">\n${json(software)}`,
  }),
}))

const listing = {
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name: 'Renplay catalog',
  url: `${SITE}/catalog`,
  mainEntity: { '@type': 'ItemList', itemListElement: games.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g.title, url: `${SITE}${gamePath(g)}` })) },
}
const ui = { state: '', tags: [], moreTags: false }
const filters = chips(games, vocab, ui)
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
    title: 'Renplay · Catalog of tested Ren’Py games',
    description: 'Ren’Py games tested in Renplay: where to get each one, which download works, and how to add it. Free to browse, safe for work.',
    canonical: `${SITE}/catalog`,
    css: ['/catalog.css'],
    extra: json(listing),
    ...OG,
  }),
}))

// ---- a page for each game ---------------------------------------------------------------------------------------------
const gameTemplate = read('pages/game.html')
const describe = (g) => {
  const store = ['itch', 'steam', 'patreon', 'subscribestar', 'website'].find((k) => /^https?:\/\//i.test(g.links?.[k] ?? ''))
  // As much as fits a search result: the summary first, then who made it, then where to get it.
  const parts = [
    g.summary ? `${g.summary.replace(/[.!?…]+$/, '')}.` : `A visual novel${shownTags(g, vocab).length ? `: ${shownTags(g, vocab).slice(0, 3).map((t) => tagLabel(vocab, t)).join(', ')}` : ''}.`,
    g.developer && `${g.free ? 'A free game' : 'A game'} by ${g.developer}, tested in Renplay.`,
    `Get it${store ? ` on ${LINKS[store]}` : ' from its developer'} and play it in your browser.`,
  ].filter(Boolean)
  let text = parts[0]
  for (const part of parts.slice(1)) if (`${text} ${part}`.length <= 158) text += ` ${part}`
  return cut(text, 158)
}
for (const g of games) {
  const p = poster(g)
  const cover = coverUrl(g)
  const portrait = !p?.width || !p?.height || p.width / p.height < 1.2
  const tags = shownTags(g, vocab).map((t) => tagLabel(vocab, t))
  const rel = working(g)
  const store = ['itch', 'steam', 'patreon', 'subscribestar', 'website'].find((k) => /^https?:\/\//i.test(g.links?.[k] ?? ''))
  const url = `${SITE}${gamePath(g)}`
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: g.title,
      url,
      description: g.summary || describe(g),
      ...(cover && { image: cover }),
      ...(g.developer && { author: { '@type': 'Organization', name: g.developer } }),
      ...(tags.length && { genre: tags }),
      applicationCategory: 'Game',
      gamePlatform: 'Web browser, through Renplay',
      operatingSystem: 'Any system that runs Renplay',
      playMode: 'SinglePlayer',
      inLanguage: 'en',
      ...(rel?.version && { version: rel.version }),
      ...(g.free && { isAccessibleForFree: true }),
      ...(store && { sameAs: [g.links[store]] }),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Renplay', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Catalog', item: `${SITE}/catalog` },
        { '@type': 'ListItem', position: 3, name: g.title, item: url },
      ],
    },
  ]
  write(OUT, `catalog/${g.id}/index.html`, render(gameTemplate, {
    modes: ['sfw'],
    ...inCatalog(''),
    footnote: FOOTNOTE_CATALOG,
    sheet: detail(g, vocab, { heading: 'h1', eager: true }),
    head: head({
      title: `${g.title} · Renplay catalog`,
      description: describe(g),
      canonical: url,
      css: ['/catalog.css'],
      ...(cover ? { image: cover, imageAlt: `${g.title} cover`, imageSize: p?.width && p?.height ? [p.width, p.height] : undefined, card: portrait ? 'summary' : 'summary_large_image' } : OG),
      extra: `${data.map(json).join('\n')}${cover ? `\n<link rel="preload" as="image" href="${esc(cover)}" fetchpriority="high" referrerpolicy="no-referrer">` : ''}`,
    }),
  }))
}

const notFound = (site) => render(read('pages/404.html'), {
  modes: ['sfw'],
  ...here(site),
  footnote: FOOTNOTE_CATALOG,
  head: head({ title: 'Page not found · Renplay', description: 'This page is not here. Go to the Renplay home page or the catalog.', robots: [['robots', 'noindex']] }),
})
write(OUT, '404.html', notFound(''))
write(OUT, 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[['/', undefined], ['/catalog', updated], ...games.map((g) => [gamePath(g), updated])].map(([path, date]) => `  <url><loc>${SITE}${path}</loc>${date ? `<lastmod>${date}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`)
write(OUT, 'robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`)

// ---- adult.renplay.org ----------------------------------------------------------------------------------------------------
const ADULT_OUT = 'dist-adult'
for (const f of ['site.css', 'catalog.css', 'logo.svg', 'favicon.ico', 'favicon-48.png', 'apple-touch-icon.png', 'js', 'NOTICE']) {
  cpSync(join(root, f), join(root, ADULT_OUT, f), { recursive: true })
}
cpSync(join(root, '../LICENSE'), join(root, ADULT_OUT, 'LICENSE'))
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
write(ADULT_OUT, 'robots.txt', 'User-agent: *\nDisallow: /\n')
write(ADULT_OUT, '_headers', `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Robots-Tag: noindex, nofollow
`)

console.log(`Built ${games.length} game pages${neverCovers ? ', and the adult catalog with its covers always blurred' : ''}.`)
