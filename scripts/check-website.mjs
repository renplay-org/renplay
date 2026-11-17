#!/usr/bin/env node
/**
 * The built website (website/dist and website/dist-adult, `sh website/build.sh`):
 *
 *  - every local link and picture in its pages is a file there, a folder with an index.html, or one of the stable addresses in
 *    _redirects, and the sitemap lists only pages (the links);
 *  - the adult site stays out of search results in a way crawlers can read (noindex-host.mjs);
 *  - the findability checklist of the rebuild, the parts a script can read from the built files: head tags, headings, pictures,
 *    structured data, the text a reader gets with scripts and frames removed, the sitemap and robots.txt, and the weight of the
 *    painted pictures. Each check names its checklist item (A-04, B-02 and so on).
 *
 * The checks that need the whole catalog (no adult game anywhere) read https://catalog.renplay.org/index.v4.json, or the copy
 * in CATALOG_FULL_FILE, and are left out when the build was made from a file (CATALOG_INDEX_FILE) with none to compare. Every
 * failure is printed, and any failure exits 1.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { noindexProblems } from './noindex-host.mjs'
import { all, first, hiddenBy, parse, squash, textOf } from './html-tree.mjs'

const root = new URL('..', import.meta.url).pathname
const site = (name) => new URL(`../website/${name}/`, import.meta.url).pathname
const SITE = 'https://renplay.org'
const broken = []
const problems = []
const fail = (where, what) => { const line = `${where}: ${what}`; if (!problems.includes(line)) problems.push(line) }

// What the home page has to say, in one place: the checks below look for each of these with scripts and frames removed.
const DEFINITION = 'Renplay is a self-hosted player for Ren’Py games in the browser, with saves on your own server.'
const TAGLINE = 'Your Ren’Py games, on every screen.'
const SCENE = [
  'The window turns violet and the house goes quiet.',
  'Somewhere in this room your story is still open, exactly where you left it. Every save is already on your own server.',
  'You have a few screens and one evening. Which do you reach for?',
]
const CHOICES = ['The phone on the sofa', 'The tablet on the side table', 'The laptop on the desk']
const MENU = ['New game', 'Continue', 'Gallery', 'Extras']
const FEATURES = ['What it plays', 'Saves and history', 'Phones and offline', 'Accounts and sign-in', 'Adult games, on your terms', 'Install', 'Mods in the browser', 'Dashboards', 'Private by design']
const STEPS = ['Add the game', 'Renplay prepares it', 'Play anywhere']
const FAQ = ['Which games work?', 'Where do I get the games?', 'Does it need a powerful server?', 'Can I still play on desktop Ren’Py?', 'Does it work without the internet?', 'What about adult games?', 'Is it really free?', 'What does it send?', 'What does the demo keep?']
const COMMANDS = ['docker run -d --name renplay -p 8080:8080', 'image: ghcr.io/renplay-org/renplay:latest']
const GUIDES = ['docker', 'kubernetes', 'truenas', 'unraid', 'synology', 'ugreen', 'qnap'].map((g) => `https://docs.renplay.org/install/${g}/`)
// Wording that must not come back: the site sends a daily report, so it says so (A-12).
const FORBIDDEN = ['no tracking', 'no telemetry', 'your server, no tracking']
// Pages of the website besides the home page, the catalog and the games (the answer pages come here), each with the paths it is at.
const OTHER_PAGES = []

/** The picture budgets of design-fable.md section 7, in bytes, by file name pattern. */
const WEIGHTS = [[/^room\/room-wide\.(avif|webp)$/, 180e3], [/^room\/room-wide-1200\.(avif|webp)$/, 120e3], [/^room\/room-tall\.(avif|webp)$/, 110e3], [/^room\/sky-.*\.webp$/, 40e3], [/^screens\//, 120e3]]

const files = (dir, ext) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = join(dir, e.name)
  return e.isDirectory() ? files(full, ext) : ext.test(e.name) ? [full] : []
})

/** One built site: renplay.org (dist) or adult.renplay.org (dist-adult). Returns what the other checks need. */
function load(dist, host) {
  if (!existsSync(dist)) {
    console.error('Build the website first: sh website/build.sh')
    process.exit(1)
  }
  // "/docs/*  https://…" covers /docs/anything. Query strings and fragments never matter here.
  const redirectLines = existsSync(join(dist, '_redirects')) ? readFileSync(join(dist, '_redirects'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : []
  const redirects = redirectLines.map((line) => line.split(/\s+/)[0])
  const redirected = (path) => redirects.some((from) => (from.endsWith('/*') ? path.startsWith(from.slice(0, -1)) : path === from))
  const exists = (path) => {
    const full = join(dist, decodeURIComponent(path))
    if (!existsSync(full)) return existsSync(`${full}.html`)
    return statSync(full).isFile() || existsSync(join(full, 'index.html'))
  }
  const pages = files(dist, /\.html$/).map((file) => {
    const html = readFileSync(file, 'utf8')
    const path = `/${relative(dist, file).replace(/(^|\/)index\.html$/, '$1')}`
    return { file, rel: relative(dist, file), path, html, tree: parse(html), host }
  })
  for (const page of pages) {
    for (const [, url] of page.html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      // Addresses the pages' scripts fill in (${…}) are checked by reading.
      if (!url || url.includes('${') || /^(https?:|mailto:|data:|#|javascript:)/.test(url)) continue
      const path = new URL(url, `${host}${page.path}`).pathname
      if (!exists(path) && !redirected(path)) broken.push(`${page.rel}: ${url}`)
    }
  }
  return { dist, host, pages, exists, redirects: redirectLines }
}

const main = load(site('dist'), SITE)
const adult = load(site('dist-adult'), 'https://adult.renplay.org')

// Every address in the sitemap is a page of the built site.
const sitemap = readFileSync(join(main.dist, 'sitemap.xml'), 'utf8')
const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])
for (const loc of locs) if (!main.exists(new URL(loc).pathname)) broken.push(`sitemap.xml: ${loc}`)

// ---- what every page of renplay.org has ---------------------------------------------------------------------------------
const meta = (page, key, by = 'name') => all(page.tree, (e) => e.name === 'meta' && e.attrs[by] === key).map((e) => e.attrs.content ?? '')
const links = (page, within = page.tree) => all(within, (e) => e.name === 'a' && e.attrs.href !== undefined).map((e) => e.attrs.href)
const isGame = (page) => /^\/catalog\/[^/]+\/$/.test(page.path)
const kindOf = (page) => (page.path === '/' ? 'home' : page.path === '/catalog/' ? 'catalog' : isGame(page) ? 'game' : page.rel === '404.html' ? '404' : 'other')
const indexable = main.pages.filter((p) => p.rel !== '404.html')
const titles = new Map(), descriptions = new Map()
const headerSets = []

for (const page of main.pages) {
  const at = page.rel
  const kind = kindOf(page)
  const html = page.tree.children.find((c) => c.name === 'html')
  if (html?.attrs.lang !== 'en') fail(at, 'A-01: <html lang="en"> is missing')
  const titleTags = all(page.tree, (e) => e.name === 'title')
  const title = squash(titleTags.map((t) => textOf(t)).join(''))
  const description = meta(page, 'description')
  const canonical = all(page.tree, (e) => e.name === 'link' && e.attrs.rel === 'canonical').map((e) => e.attrs.href)
  const robots = meta(page, 'robots').join(',')

  if (kind !== '404') {
    // A-02, A-03, D-01, D-02: one title and one description, of a length a result shows, and unlike any other page's.
    if (titleTags.length !== 1 || title.length < 15 || title.length > 65) fail(at, `A-02: the title needs one tag of 15 to 65 characters, it is "${title}" (${title.length})`)
    if (titles.has(title)) fail(at, `A-02: the title "${title}" is also ${titles.get(title)}'s`)
    titles.set(title, at)
    const d = squash(description[0] ?? '')
    if (description.length !== 1 || d.length < 70 || d.length > 160) fail(at, `A-03: the description needs one tag of 70 to 160 characters, it is ${d.length}`)
    if (descriptions.has(d)) fail(at, `A-03: the description is also ${descriptions.get(d)}'s`)
    descriptions.set(d, at)
    // A-04: one canonical, absolute, the page's own address.
    if (canonical.length !== 1 || canonical[0] !== `${SITE}${page.path}`) fail(at, `A-04: canonical should be ${SITE}${page.path}, it is ${canonical.join(' and ') || 'missing'}`)
    // A-05: Open Graph and Twitter.
    for (const k of ['og:title', 'og:description', 'og:url', 'og:type', 'og:site_name', 'og:image', 'og:image:width', 'og:image:height', 'og:image:alt']) if (meta(page, k, 'property').length !== 1) fail(at, `A-05: ${k} is missing`)
    for (const k of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) if (meta(page, k).length !== 1) fail(at, `A-05: ${k} is missing`)
    if (meta(page, 'og:url', 'property')[0] !== canonical[0]) fail(at, 'A-05: og:url is not the canonical address')
    const image = meta(page, 'og:image', 'property')[0] ?? ''
    if (!image.startsWith('https://')) fail(at, 'A-05: og:image is not an absolute https address')
    else if (image.startsWith(`${SITE}/`) && !main.exists(image.slice(SITE.length))) fail(at, `A-05: og:image ${image} is not in the build`)
    if (kind === 'game' && !image.startsWith(`${SITE}/og/`)) fail(at, `D-10: og:image should be the site's own card, it is ${image}`)
    if (!robots.includes('max-image-preview:large')) fail(at, 'A-17: the robots meta lacks max-image-preview:large')
    if (/noindex/.test(robots)) fail(at, 'A-10: an indexable page says noindex')
  } else if (!/noindex/.test(robots)) fail(at, 'A-16: the 404 page lacks noindex')

  // A-06: one h1, and the levels never skip.
  const headings = all(page.tree, (e) => /^h[1-6]$/.test(e.name) && !hiddenBy(e))
  const h1s = headings.filter((h) => h.name === 'h1')
  if (h1s.length !== 1) fail(at, `A-06: ${h1s.length} h1 headings, there should be one`)
  headings.reduce((before, h) => {
    const level = Number(h.name[1])
    if (level > before + 1) fail(at, `A-06: heading "${squash(textOf(h))}" is an h${level} after an h${before}`)
    return level
  }, 0)

  // A-07, D-08: every picture says what it shows (or is decoration in something hidden) and has its size.
  for (const img of all(page.tree, (e) => e.name === 'img')) {
    const name = img.attrs.src ?? img.attrs['data-src'] ?? img.attrs.srcset ?? '?'
    if (img.attrs.alt === undefined) fail(at, `A-07: ${name} has no alt`)
    else if (img.attrs.alt === '' && !hiddenBy(img)) fail(at, `A-07: ${name} has an empty alt and is not decoration in an aria-hidden parent`)
    if (!img.attrs.width || !img.attrs.height) fail(at, `A-07: ${name} has no width and height`)
  }

  // A-09: structured data parses, and the address in it is the page's.
  const blocks = all(page.tree, (e) => e.name === 'script' && e.attrs.type === 'application/ld+json').map((s) => s.children.map((c) => c.text ?? '').join(''))
  const ld = blocks.map((b) => {
    try { return JSON.parse(b) } catch { fail(at, 'A-09: a JSON-LD block does not parse'); return null }
  }).filter(Boolean)
  const textOfScripts = blocks.join('')
  for (const block of ld) {
    if (!block['@context'] || !block['@type']) fail(at, 'A-09: a JSON-LD block has no @context or @type')
    if (block.url !== undefined && block.url !== canonical[0]) fail(at, `A-09: ${block['@type']} url ${block.url} is not the canonical address`)
    if (JSON.stringify(block).match(/aggregateRating|"review"/) && !process.env.ALLOW_RATINGS) fail(at, 'B-08: a rating or review is claimed, and none is real')
  }
  if (/adult\.renplay\.org/.test(textOfScripts)) fail(at, 'H-03: structured data names the adult site')
  const types = ld.map((b) => b['@type'])
  const need = { home: ['SoftwareApplication', 'WebSite', 'Organization'], catalog: ['CollectionPage'], game: ['VideoGame', 'BreadcrumbList'] }[kind] ?? []
  for (const t of need) if (!types.includes(t)) fail(at, `${kind === 'home' ? 'B-08/A-14' : kind === 'catalog' ? 'C-01' : 'D-04'}: no ${t} structured data`)

  // A-11, A-08: no plain http link, no link through one of our own short addresses, and the nav's Catalog is the catalog page.
  const shorts = main.redirects.map((l) => l.split(/\s+/)).filter(([, to]) => /^https?:/.test(to ?? '')).map(([from]) => from)
  for (const href of links(page)) {
    if (/^http:\/\//.test(href)) fail(at, `A-11: ${href} is not https`)
    const path = /^https:\/\/renplay\.org(\/[^#?]*)/.exec(href)?.[1] ?? (href.startsWith('/') ? href.split(/[#?]/)[0] : '')
    if (path && shorts.includes(path)) fail(at, `A-11: ${href} goes through a short address, its target is known`)
  }
  const header = first(page.tree, (e) => e.name === 'header' && e.attrs.id === 'nav')
  if (!header) fail(at, 'A-13: no header with the navigation')
  else {
    const hrefs = links(page, header)
    const catalogLink = all(header, (e) => e.name === 'a' && squash(textOf(e)) === 'Catalog')[0]
    if (!catalogLink || !/^(https:\/\/renplay\.org)?\/catalog\/$/.test(catalogLink.attrs.href)) fail(at, 'A-08: the nav\'s Catalog does not go to /catalog/')
    headerSets.push([at, new Set(hrefs)])
    // The 404 is the room and a line of dialogue, with no footer of its own.
    const footer = kind === '404' ? [] : all(page.tree, (e) => e.name === 'footer')
    const footerLinks = new Set(footer.flatMap((f) => links(page, f)))
    if (kind !== '404') for (const want of ['/catalog/', 'https://docs.renplay.org/', 'https://github.com/renplay-org/renplay', 'https://ko-fi.com/janpuc', '/#install', ...GUIDES]) if (![...footerLinks].some((h) => h === want || h === `${SITE}${want}`)) fail(at, `A-13: the footer lacks a link to ${want}`)
  }

  // A-12: claims that are not true.
  const lower = page.html.toLowerCase()
  for (const s of FORBIDDEN) if (lower.includes(s)) fail(at, `A-12: the page says "${s}"`)
}
// A-13: the same header on every page.
for (const [at, set] of headerSets.slice(1)) {
  const [, base] = headerSets[0]
  const diff = [...base].filter((h) => !set.has(h)).concat([...set].filter((h) => !base.has(h)))
  if (diff.length) fail(at, `A-13: the header differs from ${headerSets[0][0]}'s in ${diff.join(', ')}`)
}

// ---- the home page ------------------------------------------------------------------------------------------------------
{
  const page = main.pages.find((p) => p.path === '/')
  const at = page.rel
  const section = first(page.tree, (e) => e.name === 'section' && e.attrs.id === 'top')
  // The text with every script and frame taken away is what a reader and a crawler get before anything runs.
  const text = squash(textOf(page.tree.children.find((c) => c.name === 'html')))
  const has = (s) => text.includes(s)
  const h1 = first(page.tree, (e) => e.name === 'h1')
  if (!squash(textOf(h1)).startsWith('Renplay') || !squash(textOf(h1)).includes(TAGLINE)) fail(at, `B-01: the h1 is not "Renplay" with the tagline "${TAGLINE}"`)
  // B-02, A-15: the definition is a visible lede in the first section, outside the scene's `after` and anything hidden.
  const define = first(section, (e) => e.name === 'p' && squash(textOf(e)) === DEFINITION)
  if (!define) fail(at, 'B-02: the definition sentence is not a paragraph of the first section')
  else for (let n = define; n && n !== section; n = n.parent) if (n.attrs.hidden !== undefined || /\bafter\b/.test(n.attrs.class ?? '') || n.attrs['aria-hidden'] === 'true') fail(at, 'B-02: the definition sentence sits in something hidden')
  if (meta(page, 'description')[0] !== DEFINITION) fail(at, 'A-15: the description is not the definition sentence')
  // B-03: every line of the scene is a paragraph, the choices and the menu are links with real addresses.
  const story = first(page.tree, (e) => e.attrs.id === 'story')
  const lines = story ? all(story, (e) => e.name === 'p').map((p) => squash(textOf(p))) : []
  for (const line of SCENE) if (!lines.includes(line)) fail(at, `B-03: the scene's line is not a paragraph: ${line}`)
  const choices = all(page.tree, (e) => e.name === 'a' && e.attrs['data-dev'] !== undefined)
  for (const c of CHOICES) if (!choices.some((a) => squash(textOf(a)).endsWith(c) && a.attrs.href)) fail(at, `B-03: the choice "${c}" is not a link`)
  const menu = first(page.tree, (e) => e.attrs.id === 'menu')
  const menuLinks = menu ? all(menu, (e) => e.name === 'a') : []
  for (const m of MENU) if (!menuLinks.some((a) => squash(textOf(a)).startsWith(m) && a.attrs.href && a.attrs.href !== '#')) fail(at, `B-03: the menu item "${m}" is not a link with an address`)
  // B-04, B-05, B-06: what it does, the steps, the answers and both install commands are text.
  const headingTexts = all(page.tree, (e) => /^h[2-4]$/.test(e.name)).map((h) => squash(textOf(h)))
  for (const f of [...FEATURES, ...STEPS]) if (!headingTexts.includes(f)) fail(at, `B-04: no heading "${f}"`)
  const details = all(page.tree, (e) => e.name === 'details')
  for (const q of FAQ) {
    const d = details.find((x) => squash(textOf(first(x, (e) => e.name === 'summary'))) === q)
    if (!d) fail(at, `B-05: no question "${q}"`)
    else if (squash(textOf(d)).length - q.length < 40) fail(at, `B-05: "${q}" has no answer text`)
  }
  const pres = all(page.tree, (e) => e.name === 'pre').map((p) => textOf(p))
  for (const c of COMMANDS) if (!pres.some((p) => p.includes(c))) fail(at, `B-06: no <pre> holds "${c}"`)
  // B-07: the title says what it is and that it is self-hosted.
  const title = squash(textOf(first(page.tree, (e) => e.name === 'title')))
  if (!title.includes('self-hosted') || !title.includes('Ren’Py')) fail(at, 'B-07: the title does not say self-hosted and Ren’Py')
  // B-08: the structured data of the application.
  const app = all(page.tree, (e) => e.name === 'script' && e.attrs.type === 'application/ld+json').map((s) => { try { return JSON.parse(s.children.map((c) => c.text).join('')) } catch { return {} } }).find((b) => b['@type'] === 'SoftwareApplication')
  for (const k of ['name', 'url', 'description', 'applicationCategory', 'operatingSystem', 'isAccessibleForFree', 'license']) if (!app?.[k]) fail(at, `B-08: SoftwareApplication has no ${k}`)
  if (app?.offers?.price !== '0') fail(at, 'B-08: SoftwareApplication.offers.price is not 0')
  if (app?.description !== DEFINITION) fail(at, 'B-08: SoftwareApplication.description is not the definition sentence')
  // B-09: the links the home page gives to the pages that matter.
  const hrefs = links(page)
  for (const want of ['/catalog/', 'https://docs.renplay.org/', 'https://github.com/renplay-org/renplay', ...GUIDES, ...OTHER_PAGES]) if (!hrefs.includes(want)) fail(at, `B-09: no link to ${want}`)
  // B-10: the demo's frames are labelled and lazy, with a poster each, and there is a plain link to the demo.
  const frames = all(page.tree, (e) => e.name === 'iframe')
  if (frames.length !== 2) fail(at, `B-10: ${frames.length} demo frames, there should be two`)
  for (const f of frames) {
    if (!f.attrs.title) fail(at, 'B-10: a demo frame has no title')
    if (f.attrs.loading !== 'lazy') fail(at, 'B-10: a demo frame is not loading="lazy"')
    if (!first(f.parent, (e) => e.name === 'img' && /\bposter\b/.test(e.attrs.class ?? '') && e.attrs.alt && e.attrs.width && e.attrs.height)) fail(at, 'B-10: a demo frame has no poster with alt and size')
    if (!/^https:\/\/demo\.renplay\.org\//.test(f.attrs['data-src'] ?? f.attrs.src ?? '')) fail(at, 'B-10: a demo frame does not point at https://demo.renplay.org')
    if (/visitor/.test(f.attrs['data-src'] ?? '')) fail(at, 'B-10: a demo frame carries a visitor key, and the static demo needs none')
  }
  if (!hrefs.includes('https://demo.renplay.org/') || !/Open (it|the demo)/.test(text)) fail(at, 'B-10: no plain link to open the demo')
  // B-11, B-12, B-19: the picture of the first screen, and its preload.
  const hero = first(page.tree, (e) => e.name === 'img' && Number(e.attrs.width) >= 1000)
  if (!hero) fail(at, 'B-11: no large picture in the first screen')
  else {
    if (hero.attrs.fetchpriority !== 'high' || hero.attrs.loading === 'lazy') fail(at, 'B-11: the hero picture is not fetchpriority="high", or is lazy')
    if (!hero.attrs.src && !hero.attrs.srcset) fail(at, 'B-11: the hero picture has no src or srcset')
    if (hero.parent.name !== 'picture') fail(at, 'B-11: the hero picture is not inside a <picture>')
    const sources = all(hero.parent, (e) => e.name === 'source')
    const preloads = all(page.tree, (e) => e.name === 'link' && e.attrs.rel === 'preload' && e.attrs.as === 'image')
    if (preloads.length !== 2) fail(at, `B-12: ${preloads.length} image preloads, the tall and the wide room need one each`)
    for (const p of preloads) {
      const source = sources.find((s) => (s.attrs.type ?? '') === (p.attrs.type ?? '') && (s.attrs.media ? p.attrs.media === s.attrs.media : p.attrs.media !== undefined))
      if (!p.attrs.imagesrcset || !p.attrs.imagesizes) fail(at, 'B-12: a preload has no imagesrcset and imagesizes')
      else if (!source || source.attrs.srcset !== p.attrs.imagesrcset) fail(at, `B-12: the preload of ${p.attrs.imagesrcset} is not one of the <picture>'s candidates`)
    }
    // The two media queries are never true together, not even on a square screen.
    const wide = preloads.find((p) => /min-aspect-ratio/.test(p.attrs.media ?? ''))
    const ratio = /min-aspect-ratio:\s*(\d+)\/(\d+)/.exec(wide?.attrs.media ?? '')
    if (!ratio || Number(ratio[1]) / Number(ratio[2]) <= 1) fail(at, 'B-12: the wide preload also matches a square screen')
  }
  const fontPreloads = all(page.tree, (e) => e.name === 'link' && e.attrs.rel === 'preload' && e.attrs.as === 'font')
  if (fontPreloads.length > 2) fail(at, `B-19: ${fontPreloads.length} font preloads, only Fraunces and Inter are above the fold`)
  // B-13: the fonts have fallbacks sized to them.
  if (!/size-adjust/.test(readFileSync(join(main.dist, 'design/fonts.css'), 'utf8'))) fail('design/fonts.css', 'B-13: no fallback font is sized to the web font')
  // B-16: the shelf's cards name the game in their alt and their link.
  const shelf = first(page.tree, (e) => e.attrs.id === 'shelf')
  const cards = all(shelf, (e) => e.name === 'li')
  if (cards.length < 6) fail(at, `B-16: the shelf has ${cards.length} cards`)
  for (const c of cards) {
    const a = first(c, (e) => e.name === 'a'), img = first(c, (e) => e.name === 'img')
    const name = squash(textOf(first(c, (e) => e.name === 'h3')))
    if (!/^\/catalog\/[a-z0-9-]+\/$/.test(a?.attrs.href ?? '') || !squash(textOf(a)).includes(name) || img?.attrs.alt !== `${name} cover`) fail(at, `B-16: the card of "${name}" does not link its page with "${name} cover" as its picture's alt`)
  }
  // B-18: the credits and the legal line are text.
  for (const s of ['© Tom Rothamel and contributors', 'Games and their art belong to their developers']) if (!has(s)) fail(at, `B-18: the page does not say "${s}"`)
  // The room's painting and the demo's frames are never the only way to read anything: no heading or paragraph is inside the frames.
  if (all(page.tree, (e) => e.name === 'iframe' && e.children.some((c) => c.name !== '#text')).length) fail(at, 'B-10: a frame holds content')
}

// ---- the catalog and the games ------------------------------------------------------------------------------------------
{
  const catalog = main.pages.find((p) => p.path === '/catalog/')
  const gamePages = main.pages.filter(isGame)
  const listed = new Set(links(catalog, first(catalog.tree, (e) => e.name === 'details' && /all-games/.test(e.attrs.class ?? ''))))
  for (const g of gamePages) if (!listed.has(g.path)) fail('catalog/index.html', `C-02: ${g.path} is not in the list of all games`)
  const items = all(first(catalog.tree, (e) => e.name === 'details' && /all-games/.test(e.attrs.class ?? '')), (e) => e.name === 'li').length
  const shown = /(\d+) games?/.exec(squash(textOf(first(catalog.tree, (e) => e.attrs.id === 'count'))))?.[1]
  if (Number(shown) !== items || items !== gamePages.length) fail('catalog/index.html', `C-07: the page says ${shown} games, its list has ${items} and ${gamePages.length} pages were built`)
  if (links(catalog).some((h) => h.includes('?'))) fail('catalog/index.html', 'C-03: a link carries a query string, so a filter could become a page')
  if (!links(catalog).includes('https://docs.renplay.org/guides/adding-games/')) fail('catalog/index.html', 'C-06: no link to the docs on adding games')
  const withCards = all(first(catalog.tree, (e) => e.attrs.id === 'games'), (e) => e.name === 'img' && e.attrs.alt && e.attrs.width && e.attrs.height).length
  if (withCards < 12) fail('catalog/index.html', `C-05: only ${withCards} cards are drawn with a picture, with its alt and size`)

  for (const page of gamePages) {
    const at = page.rel
    const h1 = squash(textOf(first(page.tree, (e) => e.name === 'h1')))
    const ld = all(page.tree, (e) => e.name === 'script' && e.attrs.type === 'application/ld+json').map((s) => JSON.parse(s.children.map((c) => c.text).join('')))
    const game = ld.find((b) => b['@type'] === 'VideoGame')
    const crumbs = ld.find((b) => b['@type'] === 'BreadcrumbList')
    if (game?.name !== h1) fail(at, `D-03: the h1 "${h1}" is not the structured data's name "${game?.name}"`)
    for (const k of ['name', 'url', 'description', 'image', 'gamePlatform', 'playMode', 'inLanguage']) if (!game?.[k]) fail(at, `D-04: VideoGame has no ${k}`)
    const visible = all(first(page.tree, (e) => e.name === 'ol' && /crumbs/.test(e.attrs.class ?? '')), (e) => e.name === 'a').map((a) => `${SITE}${a.attrs.href}`)
    const chain = (crumbs?.itemListElement ?? []).map((i) => i.item)
    if (visible.join() !== chain.join() || chain.at(-1) !== `${SITE}${page.path}`) fail(at, 'D-03: the visible breadcrumb is not the BreadcrumbList')
    const cover = first(page.tree, (e) => e.name === 'img' && /game-cover/.test(e.parent?.attrs.class ?? ''))
    if (cover && (squash(cover.attrs.alt) !== `${h1} cover` || cover.attrs.loading === 'lazy')) fail(at, 'D-08: the cover has no "name cover" alt, or is lazy')
    const hrefs = links(page)
    for (const want of ['/catalog/', 'https://docs.renplay.org/guides/adding-games/', '/#install']) if (!hrefs.includes(want)) fail(at, `D-09: no link to ${want}`)
    if (!/Newest working version|Download/.test(squash(textOf(page.tree.children.find((c) => c.name === 'html'))))) fail(at, 'D-05: no tested version or download is stated')
  }
}

// ---- the sitemap, robots.txt, the pictures ------------------------------------------------------------------------------
{
  const seen = new Set()
  for (const loc of locs) {
    if (!/^https:\/\/renplay\.org\//.test(loc)) fail('sitemap.xml', `M-09: ${loc} is not an https://renplay.org address`)
    if (seen.has(loc)) fail('sitemap.xml', `M-09: ${loc} is listed twice`)
    seen.add(loc)
    if (/adult\.renplay\.org/.test(loc)) fail('sitemap.xml', 'H-03: the adult site is in the sitemap')
  }
  if (locs.length > 50000) fail('sitemap.xml', 'M-09: more than 50,000 addresses')
  for (const [, date] of sitemap.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)) if (!/^\d{4}-\d{2}-\d{2}/.test(date) || Number.isNaN(Date.parse(date))) fail('sitemap.xml', `M-09: lastmod ${date} is not a date`)
  for (const page of indexable) if (!seen.has(`${SITE}${page.path}`)) fail(page.rel, 'M-09: an indexable page is not in the sitemap')
  const gameFolders = main.pages.filter(isGame).length
  if (locs.filter((l) => /\/catalog\/[^/]+\/$/.test(l)).length !== gameFolders) fail('sitemap.xml', 'M-09: the game pages in the sitemap are not the game pages built')
  // M-10: no orphan, every indexable page has a link to it from another page.
  const linked = new Set(main.pages.flatMap((p) => links(p).map((h) => new URL(h, `${SITE}${p.path}`).pathname + '').filter(Boolean)))
  for (const page of indexable) if (page.path !== '/' && !linked.has(page.path)) fail(page.rel, 'M-10: no page links to it')
  const robots = readFileSync(join(main.dist, 'robots.txt'), 'utf8')
  if (!/^User-agent:\s*\*/m.test(robots) || !/^Allow:\s*\//m.test(robots) || !robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) fail('robots.txt', 'I-01: it needs User-agent: *, Allow: / and the sitemap line')
  if (/^\s*disallow:\s*\S/im.test(robots) || /(OAI-SearchBot|Claude-SearchBot|PerplexityBot|Bingbot|Googlebot)/i.test(robots)) fail('robots.txt', 'I-01: it blocks a crawler')
  // M-17: the painted pictures stay within the design's weights.
  for (const f of files(join(main.dist, 'img'), /\.(avif|webp|jpg)$/)) {
    const name = relative(join(main.dist, 'img'), f)
    for (const [pattern, max] of WEIGHTS) if (pattern.test(name) && statSync(f).size > max) fail(`img/${name}`, `M-17: ${statSync(f).size} bytes, over the budget of ${max}`)
  }
  for (const [, , value] of [...readFileSync(join(main.dist, '_headers'), 'utf8').matchAll(/(\/\S+)\n\s+Cache-Control:\s*(.*)/g)].map((m) => [m[0], m[1], m[2]]).filter(([, p]) => /^\/img/.test(p))) if (!/max-age=\d{5,}/.test(value)) fail('_headers', 'I-06: the pictures are not cached for long')
  // The definition sentence is the same in the readme and the docs.
  for (const f of ['README.md', 'docs/site/astro.config.mjs']) if (!readFileSync(join(root, f), 'utf8').includes(DEFINITION)) fail(f, 'M-18: the definition sentence is not there')
}

// ---- the adult site ------------------------------------------------------------------------------------------------------
{
  const index = adult.pages.find((p) => p.path === '/')
  const gate = first(index.tree, (e) => /\bgate\b/.test(e.attrs.class ?? ''))
  const gateH1 = first(gate, (e) => e.name === 'h1')
  if (!gateH1 || squash(textOf(gateH1)) !== 'Are you 18 or older?') fail('dist-adult/index.html', 'H-05: the age question is not the h1 of the gate')
  if (adult.pages.some((p) => !/noindex/.test(meta(p, 'robots').join(',')))) fail('dist-adult', 'H-01: a page lacks the noindex robots meta')
  if (adult.pages.some((p) => all(p.tree, (e) => e.name === 'h1' && !hiddenBy(e)).length > 2)) fail('dist-adult', 'A-06: more h1 headings than the gate and the 404 have')
  if (existsSync(join(adult.dist, 'sitemap.xml'))) fail('dist-adult', 'H-03: the adult site has a sitemap')
}

// ---- no adult game in the build, when the whole catalog is at hand ------------------------------------------------------
// The file in CATALOG_FULL_FILE, else the catalog's own copy (unless the build was made from a file, which is a run with no network).
async function wholeCatalog() {
  if (process.env.CATALOG_FULL_FILE) return JSON.parse(readFileSync(process.env.CATALOG_FULL_FILE, 'utf8'))
  if (process.env.CATALOG_INDEX_FILE) return null
  try {
    const res = await fetch('https://catalog.renplay.org/index.v4.json', { signal: AbortSignal.timeout(30000) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}
const full = await wholeCatalog()
if (!full) console.log('The whole catalog was not at hand, so the build was not searched for adult games.')
else {
  const adults = (full.games ?? []).filter((g) => g.nsfw)
  const text = files(main.dist, /\.(html|xml|txt|js)$/).map((f) => readFileSync(f, 'utf8'))
  for (const g of adults) {
    if (main.exists(`/catalog/${g.id}/`)) fail('dist', `C-04: a page was built for the adult game ${g.id}`)
    if (text.some((t) => t.includes(`"${g.id}"`) || t.includes(`/catalog/${g.id}/`) || t.includes(`>${g.title}<`))) fail('dist', `H-04: the adult game ${g.id} is named in the build`)
  }
  console.log(`${adults.length} adult games checked against the build.`)
}

const noindex = noindexProblems(adult.dist, 'adult.renplay.org')

if (broken.length) {
  console.error(`Links to nothing in the website:\n${broken.join('\n')}`)
  process.exit(1)
}
if (noindex.length) {
  console.error(`The adult site is not kept out of search results:\n${noindex.join('\n')}`)
  process.exit(1)
}
if (problems.length) {
  console.error(`The website does not meet its findability checklist (renplay-plans/website/seo/checklist.md):\n${problems.join('\n')}`)
  process.exit(1)
}
console.log(`Every link in the website leads somewhere, the adult site says noindex where crawlers can read it, and ${main.pages.length} pages meet the findability checks.`)
