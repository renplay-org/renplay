// The social cards (Open Graph and Twitter): 1200 x 630 pictures made at build time, from the site's own art and letters.
// A game's card is its cover and its name, so a shared link never depends on the developer's host still answering. The
// colours come from design/tokens.css, the letters from lib/glyphs.mjs and the name of the site from design/logo/wordmark.svg.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fit, textPath } from './glyphs.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CARD = [1200, 630]

// sharp comes from the server's packages, as it does for design/build.mjs.
let sharpModule
const sharp = () => (sharpModule ??= createRequire(join(root, '../server/package.json'))('sharp'))

const tokens = new Map([...readFileSync(join(root, '../design/tokens.css'), 'utf8').matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]))
const token = (name) => {
  if (!tokens.has(name)) throw new Error(`design/tokens.css has no colour ${name}`)
  return tokens.get(name)
}
const wordmark = readFileSync(join(root, '../design/logo/wordmark.svg'))

/** The wordmark at a width, as a picture to lay on a card. */
const mark = (width) => sharp()(wordmark, { density: 144 }).resize({ width }).png().toBuffer()

/** The shade of a colour mixed into the ink, as a hex colour. */
function mix(hex, share, base = token('--ink')) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)), b = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16))
  return `#${a.map((v, i) => Math.round(v * share + b[i] * (1 - share)).toString(16).padStart(2, '0')).join('')}`
}

async function finish(svg, layers) {
  const png = await sharp()(Buffer.from(svg)).png().toBuffer()
  return sharp()(png).composite(layers).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
}

/** A game's card: its cover on the left, lit by its own colour, and its name and developer. `cover` is the picture's bytes, or null. */
export async function gameCard({ title, developer, tint, cover }) {
  const [W, H] = CARD
  const lit = /^#[0-9a-f]{6}$/i.test(tint ?? '') ? tint : token('--fg-4')
  const box = { x: 84, y: 60, w: 360, h: 540 }
  const text = { x: 520, max: W - 520 - 72 }
  const by = developer ? fit(`By ${developer}`, [34, 28, 24], text.max, 1) : null
  // The name and the line under it are set in the space between the label at the top and the wordmark at the bottom, as large as they go.
  const area = { top: 170, height: 300 }
  let name
  for (const size of [92, 80, 68, 58, 50, 44, 38]) {
    name = fit(title, [size], text.max, 5)
    if (name.lines.length * size * 1.08 + (by ? size * 0.35 + by.size * 1.2 : 0) <= area.height) break
  }
  const total = name.lines.length * name.size * 1.08 + (by ? name.size * 0.35 + by.size * 1.2 : 0)
  const nameTop = area.top + (area.height - total) / 2 + name.size * 0.85
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <radialGradient id="g1" cx="22%" cy="40%" r="70%"><stop offset="0" stop-color="${mix(lit, 0.55)}"/><stop offset="1" stop-color="${token('--ink')}"/></radialGradient>
      <radialGradient id="g2" cx="100%" cy="0%" r="60%"><stop offset="0" stop-color="${mix(token('--violet'), 0.28)}"/><stop offset="1" stop-color="${token('--ink')}" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g2)"/>
    <rect x="${box.x - 1}" y="${box.y - 1}" width="${box.w + 2}" height="${box.h + 2}" rx="5" fill="${mix(lit, 0.6)}"/>
    <path d="${textPath(['Renplay catalog'], { size: 30, x: text.x, y: 120 })}" fill="${token('--fg-3')}"/>
    <path d="${textPath(name.lines, { size: name.size, x: text.x, y: nameTop, lead: 1.08 })}" fill="${token('--fg')}"/>
    ${by ? `<path d="${textPath(by.lines, { size: by.size, x: text.x, y: nameTop + (name.lines.length - 1) * name.size * 1.08 + name.size * 0.35 + by.size * 1.1 })}" fill="${token('--fg-3')}"/>` : ''}
  </svg>`
  const layers = []
  if (cover) {
    // A cover of any shape fits the box whole, on the card's own colour.
    const picture = await sharp()(cover).resize({ width: box.w, height: box.h, fit: 'contain', background: mix(lit, 0.3) }).png().toBuffer()
    const round = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}"><rect width="${box.w}" height="${box.h}" rx="4" fill="#fff"/></svg>`)
    layers.push({ input: await sharp()(picture).composite([{ input: round, blend: 'dest-in' }]).png().toBuffer(), left: box.x, top: box.y })
  } else {
    // No cover to show: the name alone, as the catalog's own title card has it.
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}"><rect width="${box.w}" height="${box.h}" rx="4" fill="${mix(lit, 0.3)}"/></svg>`), left: box.x, top: box.y })
  }
  layers.push({ input: await mark(190), left: W - 190 - 72, top: H - 72 - 60 })
  return finish(svg, layers)
}

/** The home page's card: the room, the name and the line under it. `room` is the path of the room's painting. */
export async function homeCard({ room, tagline, line }) {
  const [W, H] = CARD
  const painting = await sharp()(room).resize({ width: W, height: H, fit: 'cover', position: 'centre' }).modulate({ brightness: 1.15 }).png().toBuffer()
  const lines = fit(tagline, [58, 50, 44], 600, 3)
  const small = fit(line, [28, 24], 600, 2)
  const top = 330
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${token('--ink')}" stop-opacity="0.94"/><stop offset="0.5" stop-color="${token('--ink')}" stop-opacity="0.78"/><stop offset="1" stop-color="${token('--ink')}" stop-opacity="0"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#shade)"/>
    <path d="${textPath(lines.lines, { size: lines.size, x: 72, y: top, lead: 1.1 })}" fill="${token('--fg')}"/>
    <path d="${textPath(small.lines, { size: small.size, x: 72, y: top + lines.lines.length * lines.size * 1.1 + 20, lead: 1.25 })}" fill="${token('--fg-3')}"/>
  </svg>`
  return sharp()(painting).composite([{ input: Buffer.from(svg), left: 0, top: 0 }, { input: await mark(420), left: 66, top: 90 }]).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
}

/** The bytes of a cover from the catalog's host, or null when it is not there or not a picture. */
export async function fetchCover(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'renplay-website-build' } })
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    return bytes.length > 12e6 ? null : bytes
  } catch {
    return null
  }
}
