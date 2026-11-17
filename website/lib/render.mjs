// Templates and the tags in a page's head, for build.mjs.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { esc } from '../js/catalog-view.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const read = (path) => readFileSync(join(root, path), 'utf8')

const PARTIAL = '\\{\\{(nav|footer|backdrop|footlinks|guides)\\}\\}'

/** Templates: {{name}}, {{partial}}, and <!--if mode-->…<!--else-->…<!--endif--> blocks. */
export function render(template, vars) {
  let text = template
  // A partial can hold another (the footer holds the links), so they are filled in until none is left.
  for (let i = 0; i < 3 && new RegExp(PARTIAL).test(text); i++) text = text.replace(new RegExp(PARTIAL, 'g'), (_, name) => read(`partials/${name}.html`))
  const blocks = text.replace(/<!--if (\w+)-->([\s\S]*?)(?:<!--else-->([\s\S]*?))?<!--endif-->/g, (_, key, yes, no = '') => (vars.modes.includes(key) ? yes : no))
  return blocks.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`The template uses {{${key}}}, which the build does not set`)
    return vars[key]
  })
}

/** Cut at a word, ending with a full stop: the writing rule has no ellipses. */
export const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/[\s,;:.!?]*\S*$/, '')}.`)
export const json = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`

/**
 * The tags in a page's head: title, description, address, cards and icons. `robots` is a list of [name, content] pairs
 * (an indexable page allows large previews, the 404 and the adult catalog say noindex). `preloads` are link tags the page
 * wants before its stylesheets are read, `extra` is anything else (structured data).
 */
export function head({ title, description, canonical, image, imageAlt, imageSize, card = 'summary_large_image', robots, css = [], preloads = [], extra = '' }) {
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    canonical && `<link rel="canonical" href="${esc(canonical)}">`,
    ...(robots ?? [['robots', 'max-image-preview:large']]).map(([name, content]) => `<meta name="${name}" content="${content}">`),
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Renplay">',
    '<meta property="og:locale" content="en_US">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    canonical && `<meta property="og:url" content="${esc(canonical)}">`,
    image && `<meta property="og:image" content="${esc(image)}">`,
    image && imageSize && `<meta property="og:image:width" content="${imageSize[0]}"><meta property="og:image:height" content="${imageSize[1]}">`,
    image && `<meta property="og:image:alt" content="${esc(imageAlt)}">`,
    `<meta name="twitter:card" content="${card}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    image && `<meta name="twitter:image" content="${esc(image)}">`,
    image && `<meta name="twitter:image:alt" content="${esc(imageAlt)}">`,
    '<meta name="theme-color" content="#0a0a0f">',
    '<link rel="icon" href="/logo.svg" type="image/svg+xml">',
    '<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">',
    '<link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="preload" href="/design/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="preload" href="/design/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>',
    ...preloads,
    ...['/design/fonts.css', '/design/tokens.css', '/site.css', ...css].map((href) => `<link rel="stylesheet" href="${href}">`),
    extra,
  ].filter(Boolean).join('\n')
}
