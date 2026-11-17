// A small reader for the website's built pages (scripts/check-website.mjs): the tags of a page as a tree, with no dependency.
// It reads the HTML the build writes, which is plain and well formed, and is not a general parser.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const RAW = new Set(['script', 'style', 'textarea'])

/** @returns {{name: string, attrs: Record<string, string>, children: any[], parent: any, text?: string}} the root, named "#root". Text is a node named "#text". */
export function parse(html) {
  const root = { name: '#root', attrs: {}, children: [], parent: null }
  let node = root
  const tag = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
  let last = 0
  for (let m; (m = tag.exec(html));) {
    if (m.index > last) node.children.push({ name: '#text', text: html.slice(last, m.index), parent: node })
    last = tag.lastIndex
    if (m[0].startsWith('<!--')) continue
    const [, close, raw, rest] = m
    const name = raw.toLowerCase()
    if (close) {
      for (let up = node; up && up !== root; up = up.parent) if (up.name === name) { node = up.parent; break }
      continue
    }
    const attrs = {}
    for (const a of rest.matchAll(/([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? ''
    const el = { name, attrs, children: [], parent: node }
    node.children.push(el)
    if (RAW.has(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, last)
      const stop = end < 0 ? html.length : end
      el.children.push({ name: '#text', text: html.slice(last, stop), parent: el })
      tag.lastIndex = last = stop
      continue
    }
    if (!VOID.has(name) && !rest.trimEnd().endsWith('/')) node = el
  }
  if (last < html.length) node.children.push({ name: '#text', text: html.slice(last), parent: node })
  return root
}

/** Every element under a node (depth first, in document order) that the test accepts. */
export function all(node, test = () => true, out = []) {
  for (const c of node.children ?? []) {
    if (c.name === '#text') continue
    if (test(c)) out.push(c)
    all(c, test, out)
  }
  return out
}
export const first = (node, test) => all(node, test)[0]

/** The text under a node, as a reader sees it with scripts: tags and the contents of scripts, styles and frames left out. */
export function textOf(node, { skip = [] } = {}) {
  if (node.name === '#text') return node.text
  if (['script', 'style', 'iframe', 'noscript', ...skip].includes(node.name)) return ''
  return (node.children ?? []).map((c) => textOf(c, { skip })).join(node.name === 'p' || /^h\d$/.test(node.name) || node.name === 'li' ? ' ' : '')
}
export const squash = (s) => s.replace(/&(?:amp|#38);/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()

/** True when the element, or one of its parents, is hidden from a reader: aria-hidden, hidden, or a presentation role. */
export const hiddenBy = (el) => {
  for (let n = el; n && n.name !== '#root'; n = n.parent) if (n.attrs.hidden !== undefined || n.attrs['aria-hidden'] === 'true' || n.attrs.role === 'presentation') return true
  return false
}
