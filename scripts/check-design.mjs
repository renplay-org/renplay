// Checks that the look comes from design/tokens.css (Lamplight, design/README.md): no colour, gradient, face or corner
// written as a literal anywhere else, no Tailwind colour or radius utility, and in the library no duration. White and black at
// any alpha, transparent and currentColor are fine (shadows, hairlines, text on paper).
//
//   node scripts/check-design.mjs [repository folder] [--counts]
//
// ALLOWED holds today's offenders by file and count, like LARGER in check-structure.mjs: a file may only shrink, and
// when it does its allowance is lowered to match. --counts lists every file's count, to write the new allowance from.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const repo = resolve(new URL('..', import.meta.url).pathname)
const args = process.argv.slice(2)
const root = resolve(args.find((a) => !a.startsWith('--')) ?? repo)
const TOKENS = 'design/tokens.css'

/** Where the look is written: the library, the website's pages, the docs, and the game page's two files. */
const SCAN = [
  ['selector/src', /\.(css|tsx|ts)$/],
  ['website', /\.(css|html)$/, /\/(dist|dist-adult|node_modules)\//],
  ['docs/site/src', /\.(css|astro)$/],
  ['runtime', /\.js$/, /\/vendor\//],
  ['server/src/play', /\.ts$/],
]

/** Places that may keep this many literals for now, each one to move to a token. Counts only go down. */
const ALLOWED = {
}

const files = []
for (const [dir, ext, skip] of SCAN) {
  const walk = (d) => {
    if (!existsSync(d)) return
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (skip?.test(`${p}/`) || name === 'node_modules' || name.startsWith('.')) continue
      if (statSync(p).isDirectory()) walk(p)
      else if (ext.test(name)) files.push(p)
    }
  }
  walk(join(root, dir))
}

const NAMED = 'red|green|blue|gray|grey|orange|pink|purple|violet|yellow|cyan|magenta|silver|gold|navy|teal|lime|olive|maroon|aqua|fuchsia|salmon|coral|crimson|indigo|ivory|khaki|lavender|linen|plum|tan|tomato|wheat|beige'
const HEX = /(?<![&\w-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi
const FUNCTION = /\b(?:rgba?|hsla?|oklch|oklab|color)\(([^)]*)\)/gi
const GRADIENT = /\b(?:linear|radial|conic)-gradient\(((?:[^()]|\([^()]*\))*)\)/gi
const FACE = /(?<![\w-])font-family\s*:\s*([^;}]+)|(?<![\w-])font\s*:\s*([^;}]+)/g
const CORNER = /(?<![\w-])border-radius\s*:\s*([^;}"'`]+)/g
const INLINE_FACE = /\bfontFamily\s*:\s*([^}]+)/g
const INLINE_CORNER = /\bborderRadius\s*:\s*([^,}]+)/g
const DURATION = /(?<![\w-])(?:transition|animation)(?:-duration|-delay)?\s*:\s*([^;}`]+)/g
const TIME = /(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g
const NAMED_IN_CODE = new RegExp(`\\b(?:color|background|backgroundColor|fill|stroke|borderColor)\\s*[:=]\\s*['"](?:${NAMED})['"]`, 'g')
const UTILITY = /\b(?:bg|text|border|from|via|to|ring|outline|fill|stroke|decoration|shadow|accent|caret|divide)-(?:red|green|blue|white|black|gray|zinc|neutral|slate|stone|orange|amber|yellow|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose|ink|accent)(?:-\d+)?(?:\/\d+)?(?![\w-])|(?<![\w-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?(?:-(?:none|sm|md|lg|xl|2xl|3xl|4xl|full))?(?![\w-])|(?<![\w-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?-\[(?!0(?:px)?\])/g

/** Black or white at any alpha, written any of the usual ways, and the colours that are no colour. */
const neutral = (s) => /^(?:#(?:fff|ffff|000|0000|ffffff|000000|ffffff[0-9a-f]{2}|000000[0-9a-f]{2})|(?:rgba?|hsla?)\(\s*(?:255\s*,?\s*255\s*,?\s*255|0\s*,?\s*0\s*,?\s*0|0\s+0%\s+100%|0\s+0%\s+0%)\b[^)]*\)|transparent|currentcolor)$/i.test(s.trim())
/** A corner that is zero, inherited, a circle or a token, or worked out from one at run time. */
const cornerOk = (v) => v.includes('${') || v.trim().replace(/\s*!important$/, '').split(/\s+(?![^(]*\))/).every((part) => /^(?:0|0px|inherit|50%|var\(--r-[\w-]+\))$/.test(part.replace(/^['"]|['"]$/g, '')))
/** A face that is a token or inherited. */
const faceOk = (v) => /^(?:inherit|initial|unset)$/.test(v.trim()) || /var\(--(?:sans|serif|mono)\)/.test(v)

const blank = (m) => m.replace(/[^\n]/g, ' ')
/** The text with its comments blanked, so lines still count right. */
const withoutComments = (text, file) => {
  let out = text.replace(/(^|[\s;{(,])\/\*[\s\S]*?\*\//g, (m, p) => p + blank(m.slice(p.length)))
  if (/\.(html|astro)$/.test(file)) out = out.replace(/<!--[\s\S]*?-->/g, blank)
  if (/\.(tsx?|js|astro)$/.test(file)) out = out.replace(/(^|[\s;{(,])\/\/.*$/gm, (m, p) => p + blank(m.slice(p.length)))
  return out
}

/** The tokens, to check the few literals the game page keeps (a comment names the token). */
const tokens = new Map()
if (existsSync(join(root, TOKENS))) for (const m of readFileSync(join(root, TOKENS), 'utf8').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim())

const problems = []
const counts = {}
for (const file of files) {
  const rel = relative(root, file)
  const raw = readFileSync(file, 'utf8')
  const text = withoutComments(raw, file)
  const code = /\.(tsx|ts|js|astro)$/.test(file)
  const report = (index, what, found) => {
    counts[rel] = (counts[rel] ?? 0) + 1
    problems.push({ rel, line: text.slice(0, index).split('\n').length, what, found: found.trim().replace(/\s+/g, ' ').slice(0, 80) })
  }
  if (/(^|\/)(runtime|server\/src\/play)\//.test(rel)) {
    // The game page loads none of our CSS. A colour it paints is a literal with its token's name after it: `#0a0a0f /* --ink */`.
    for (const m of raw.matchAll(/(?<![&\w])(#[0-9a-f]{3,8})\b(?:\s*\/\*\s*(--[\w-]+)\s*\*\/)?/gi)) {
      if (neutral(m[1])) continue
      if (!m[2]) report(m.index, 'a colour with no token named after it', m[1])
      else if (tokens.get(m[2])?.toLowerCase() !== m[1].toLowerCase()) report(m.index, `${m[2]} is ${tokens.get(m[2]) ?? 'not a token'}`, m[1])
    }
    continue
  }
  for (const m of text.matchAll(HEX)) {
    if (/href\s*=\s*["']$/.test(text.slice(Math.max(0, m.index - 8), m.index))) continue
    if (!neutral(m[0])) report(m.index, 'colour', m[0])
  }
  for (const m of text.matchAll(FUNCTION)) if (!neutral(m[0]) && !/var\(--/.test(m[1])) report(m.index, 'colour', m[0])
  for (const m of text.matchAll(GRADIENT)) {
    const colours = m[1].replace(/var\(--[\w-]+\)/g, '').match(new RegExp(`${HEX.source}|\\b(?:rgba?|hsla?|oklch)\\([^)]*\\)`, 'gi')) ?? []
    if (colours.some((c) => !neutral(c))) report(m.index, 'gradient with a colour', m[0])
  }
  for (const m of text.matchAll(FACE)) if (!faceOk(m[1] ?? m[2])) report(m.index, 'face', m[0])
  for (const m of text.matchAll(CORNER)) if (!cornerOk(m[1])) report(m.index, 'corner', m[1])
  // A duration is a token (--t-press, --t-focus, --t-pane, --t-travel, --t-room). Nothing is a literal in the library or the docs,
  // which have none now: the website's stylesheets are held to the rest until they move.
  if (rel.startsWith('selector/src/') || rel.startsWith('docs/site/src/')) {
    for (const m of text.matchAll(DURATION)) {
      for (const t of m[1].matchAll(TIME)) if (Number(t[1]) !== 0) report(m.index, 'duration', `${t[1]}${t[2]}`)
    }
    for (const m of text.matchAll(/(?<![\w-])duration-\d+/g)) report(m.index, 'duration', m[0])
  }
  if (code) {
    for (const m of text.matchAll(NAMED_IN_CODE)) report(m.index, 'named colour', m[0])
    for (const m of text.matchAll(INLINE_FACE)) if (!faceOk(m[1])) report(m.index, 'face', m[0])
    for (const m of text.matchAll(INLINE_CORNER)) if (!cornerOk(m[1])) report(m.index, 'corner', m[1])
    for (const m of text.matchAll(UTILITY)) report(m.index, 'Tailwind utility', m[0])
  } else {
    for (const m of text.matchAll(new RegExp(`:\\s*(${NAMED})\\s*[;}]`, 'g'))) report(m.index, 'named colour', m[1])
  }
}

const allowed = root === repo ? ALLOWED : {}
const over = Object.entries(counts).filter(([file, count]) => count > (allowed[file] ?? 0)).map(([file]) => file)
const failures = problems.filter((p) => over.includes(p.rel)).map((p) => `${p.rel}:${p.line}: ${p.what}: ${p.found}`)
for (const [file, max] of Object.entries(allowed)) {
  const count = counts[file] ?? 0
  if (count < max) failures.push(`${file} shrank to ${count}: lower its allowance in scripts/check-design.mjs to match`)
}

if (args.includes('--counts')) {
  for (const [file, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`${String(count).padStart(5)}  ${file}`)
  console.log(`${problems.length} in ${Object.keys(counts).length} files`)
} else if (failures.length) {
  console.error(failures.join('\n'))
  console.error(`\n${failures.length} design ${failures.length === 1 ? 'problem' : 'problems'}. design/README.md says which token to use.`)
  process.exit(1)
} else console.log(`The look comes from ${TOKENS}.`)
