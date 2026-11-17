// Text as outlines, for the social cards (lib/og.mjs): the outlines of a TrueType font's glyphs, set in lines, as SVG path data.
// Pictures that are drawn at build time cannot count on a font the machine has, and the image library's text needs fontconfig,
// which not every machine has, so the card carries its own letters.
//
// The font is lib/fraunces-card.ttf: Fraunces (SIL OFL 1.1) from design/fonts/fraunces.woff2, as one static instance (optical
// size 72, weight 700) cut to Latin, made with fonttools:
//   instancer.instantiateVariableFont(font, {opsz: 72, wght: 700}), then pyftsubset --unicodes=U+0020-007E,U+00A0-017F,
//   U+2018,U+2019,U+201C,U+201D,U+2022 --layout-features=kern
// It reads the tables a Latin font has (head, maxp, hhea, hmtx, cmap, loca, glyf) and no kerning, so a pair is set at its
// plain advance. A letter the font does not have is left out.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const buf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fraunces-card.ttf'))
const tables = {}
for (let i = 0; i < buf.readUInt16BE(4); i++) {
  const at = 12 + i * 16
  tables[buf.toString('latin1', at, at + 4)] = { offset: buf.readUInt32BE(at + 8), length: buf.readUInt32BE(at + 12) }
}
const head = tables.head.offset
const UNITS = buf.readUInt16BE(head + 18)
const longLoca = buf.readInt16BE(head + 50) === 1
const hMetrics = buf.readUInt16BE(tables.hhea.offset + 34)

/** The glyph for each character, from the font's cmap (format 4, the one a Latin subset has). */
const cmap = new Map()
{
  const t = tables.cmap.offset
  for (let i = 0; i < buf.readUInt16BE(t + 2); i++) {
    const sub = t + buf.readUInt32BE(t + 4 + i * 8 + 4)
    if (buf.readUInt16BE(sub) !== 4) continue
    const segs = buf.readUInt16BE(sub + 6) / 2
    const ends = sub + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, offsets = deltas + segs * 2
    for (let s = 0; s < segs; s++) {
      const end = buf.readUInt16BE(ends + s * 2), start = buf.readUInt16BE(starts + s * 2), delta = buf.readInt16BE(deltas + s * 2), range = buf.readUInt16BE(offsets + s * 2)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        const glyph = range === 0 ? (c + delta) & 0xffff : buf.readUInt16BE(offsets + s * 2 + range + (c - start) * 2)
        if (glyph) cmap.set(c, range === 0 ? glyph : (glyph + delta) & 0xffff)
      }
    }
    break
  }
}

const advance = (g) => buf.readUInt16BE(tables.hmtx.offset + Math.min(g, hMetrics - 1) * 4)
const glyphAt = (g) => {
  const loca = (i) => (longLoca ? buf.readUInt32BE(tables.loca.offset + i * 4) : buf.readUInt16BE(tables.loca.offset + i * 2) * 2)
  const start = loca(g), end = loca(g + 1)
  return start === end ? null : tables.glyf.offset + start
}

/** A glyph's contours as lists of points [x, y, onCurve], with a composite's parts placed and scaled. */
function contours(g, depth = 0) {
  const at = glyphAt(g)
  if (at === null || depth > 4) return []
  const n = buf.readInt16BE(at)
  let p = at + 10
  if (n < 0) {
    const out = []
    for (let more = true; more;) {
      const flags = buf.readUInt16BE(p), part = buf.readUInt16BE(p + 2)
      p += 4
      let dx, dy
      if (flags & 1) { dx = buf.readInt16BE(p); dy = buf.readInt16BE(p + 2); p += 4 } else { dx = buf.readInt8(p); dy = buf.readInt8(p + 1); p += 2 }
      if (!(flags & 2)) { dx = 0; dy = 0 } // matched points are not used by the letters of a Latin font
      let a = 1, b = 0, c = 0, d = 1
      const f2 = () => { const v = buf.readInt16BE(p) / 16384; p += 2; return v }
      if (flags & 8) a = d = f2()
      else if (flags & 0x40) { a = f2(); d = f2() }
      else if (flags & 0x80) { a = f2(); b = f2(); c = f2(); d = f2() }
      for (const contour of contours(part, depth + 1)) out.push(contour.map(([x, y, on]) => [a * x + c * y + dx, b * x + d * y + dy, on]))
      more = !!(flags & 0x20)
    }
    return out
  }
  const ends = Array.from({ length: n }, (_, i) => buf.readUInt16BE(p + i * 2))
  p += n * 2
  p += 2 + buf.readUInt16BE(p) // the instructions
  const count = n ? ends[n - 1] + 1 : 0
  const flags = []
  while (flags.length < count) {
    const f = buf.readUInt8(p++)
    flags.push(f)
    if (f & 8) for (let r = buf.readUInt8(p++); r > 0; r--) flags.push(f)
  }
  const read = (short, same) => {
    const out = []
    let v = 0
    for (const f of flags) {
      if (f & short) { const d = buf.readUInt8(p++); v += f & same ? d : -d } else if (!(f & same)) { v += buf.readInt16BE(p); p += 2 }
      out.push(v)
    }
    return out
  }
  const xs = read(2, 16), ys = read(4, 32)
  const out = []
  let first = 0
  for (const end of ends) {
    out.push(Array.from({ length: end - first + 1 }, (_, i) => [xs[first + i], ys[first + i], !!(flags[first + i] & 1)]))
    first = end + 1
  }
  return out
}

/** One contour as path data: the quadratic curves of a TrueType outline, with the points between two off-curve points implied. */
function pathOf(points, scale, x0, y0) {
  if (!points.length) return ''
  const pt = ([x, y]) => `${(x0 + x * scale).toFixed(1)} ${(y0 - y * scale).toFixed(1)}`
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  let ring = points
  // start on a point that is on the curve (or on the middle of two that are not)
  const first = ring.findIndex((q) => q[2])
  let start
  if (first >= 0) { ring = ring.slice(first).concat(ring.slice(0, first)); start = ring[0] } else { start = mid(ring[0], ring[ring.length - 1]); ring = [[...start, true], ...ring] }
  let d = `M${pt(start)}`
  for (let i = 1; i <= ring.length; i++) {
    const q = ring[i % ring.length]
    if (q[2]) { d += i === ring.length ? '' : `L${pt(q)}`; continue }
    const next = ring[(i + 1) % ring.length]
    const to = next[2] ? next : mid(q, next)
    d += `Q${pt(q)} ${pt(to)}`
    if (next[2]) i++
  }
  return `${d}Z`
}

/** The width of a line of text at a size, in pixels. */
export const widthOf = (text, size) => [...text].reduce((w, ch) => w + (cmap.has(ch.codePointAt(0)) ? advance(cmap.get(ch.codePointAt(0))) : 0), 0) * size / UNITS

/** Words set in lines no wider than `max`, as many lines as it takes. */
export function wrap(text, size, max) {
  const lines = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && widthOf(next, size) > max) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** The largest size, from `sizes` (biggest first), at which the text sets in at most `maxLines` lines of `max` pixels. The last size is used when none fits. */
export function fit(text, sizes, max, maxLines) {
  for (const size of sizes) {
    const lines = wrap(text, size, max)
    if (lines.length <= maxLines && lines.every((l) => widthOf(l, size) <= max)) return { size, lines }
  }
  const size = sizes[sizes.length - 1]
  return { size, lines: wrap(text, size, max).slice(0, maxLines) }
}

/** SVG path data for lines of text, the first baseline at `y`, each line `lead` times the size below the one before. */
export function textPath(lines, { size, x, y, lead = 1.1, anchor = 'start' }) {
  const scale = size / UNITS
  let d = ''
  lines.forEach((text, row) => {
    let pen = anchor === 'end' ? x - widthOf(text, size) : x
    for (const ch of text) {
      const g = cmap.get(ch.codePointAt(0))
      if (!g) continue
      for (const contour of contours(g)) d += pathOf(contour, scale, pen, y + row * size * lead)
      pen += advance(g) * scale
    }
  })
  return d
}
