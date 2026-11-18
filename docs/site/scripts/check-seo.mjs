// The built docs (dist/, `npm run build`) are ready for search engines and for sharing: every page has its own title and a description of
// at least 50 characters, a canonical address, the Open Graph tags with a card picture that the build has, and one h1. Every page is in
// the sitemap, and the image tag the guides pin is the chart's appVersion (checklist F-01, F-02 and the must items of A-02 to A-04).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const dist = new URL('../dist/', import.meta.url).pathname
const site = 'https://docs.renplay.org'
const DEFAULT = 'Renplay is a self-hosted player for Ren’Py games in the browser, with saves on your own server.'
const problems = []

const pages = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '_astro' && name !== 'pagefind' && name !== '_llms-txt') walk(path)
    } else if (name === 'index.html') pages.push(path)
  }
}
walk(dist)

const decode = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const meta = (html, attr, name) => {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
    if (new RegExp(`\\b${attr}="${name}"`).test(tag)) return decode(/\bcontent="([^"]*)"/.exec(tag)?.[1] ?? '')
  }
}

const sitemap = existsSync(join(dist, 'sitemap-0.xml')) ? readFileSync(join(dist, 'sitemap-0.xml'), 'utf8') : (problems.push('sitemap-0.xml is missing'), '')
const chart = readFileSync(new URL('../../../charts/renplay/Chart.yaml', import.meta.url), 'utf8')
const appVersion = /^appVersion:\s*"?([\w.-]+)"?/m.exec(chart)?.[1]
const titles = new Map()
const descriptions = new Map()

for (const file of pages) {
  const id = relative(dist, file).replace(/index\.html$/, '')
  const html = readFileSync(file, 'utf8')
  const where = `/${id}`
  const title = decode(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? '').trim()
  const description = meta(html, 'name', 'description')
  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1]

  if (!title) problems.push(`${where} has no title`)
  else if (titles.has(title)) problems.push(`${where} has the title of ${titles.get(title)}: ${title}`)
  else titles.set(title, where)

  if (!description || description.length < 50) problems.push(`${where} needs a description of at least 50 characters (it has ${description?.length ?? 0})`)
  else if (descriptions.has(description)) problems.push(`${where} has the description of ${descriptions.get(description)}`)
  else descriptions.set(description, where)
  if (description === DEFAULT && id) problems.push(`${where} has the site's description, not its own`)

  if (canonical !== `${site}/${id}`) problems.push(`${where} has the canonical ${canonical}, not ${site}/${id}`)
  if (!sitemap.includes(`<loc>${site}/${id}</loc>`)) problems.push(`${where} is not in the sitemap`)

  const h1 = (html.match(/<h1[\s>]/g) ?? []).length
  if (h1 !== 1) problems.push(`${where} has ${h1} h1 elements`)

  for (const [attr, name] of [['property', 'og:title'], ['property', 'og:description'], ['property', 'og:url'], ['property', 'og:image'], ['property', 'og:image:alt'], ['name', 'twitter:card'], ['name', 'twitter:image']]) {
    if (!meta(html, attr, name)) problems.push(`${where} has no ${name}`)
  }
  if (meta(html, 'property', 'og:url') !== `${site}/${id}`) problems.push(`${where} has an og:url other than its canonical address`)
  const image = meta(html, 'property', 'og:image')
  if (image) {
    if (!image.startsWith(`${site}/`)) problems.push(`${where} has a card picture that the docs do not serve: ${image}`)
    else if (!existsSync(join(dist, image.slice(site.length + 1)))) problems.push(`${where} has a card picture the build does not have: ${image}`)
  }

  for (const [, tag] of html.matchAll(/renplay-org\/renplay:(\d+\.\d+\.\d+)/g)) {
    if (tag !== appVersion) problems.push(`${where} pins ${tag}, and the chart's appVersion is ${appVersion}`)
  }
}

if (pages.length < 20) problems.push(`Only ${pages.length} pages were built`)
if (problems.length) {
  console.error(`The docs are not ready for search engines:\n${problems.join('\n')}`)
  process.exit(1)
}
console.log(`${pages.length} pages: titles, descriptions, canonical addresses, the card, one h1 and the sitemap are right.`)
