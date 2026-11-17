import { readFileSync, readdirSync } from 'node:fs'

// llms.txt lists the docs one page to a line. The plugin lists "sets" of pages, so each page is a set of its own, in
// the order of the sidebar: the line is the page's title and description, and its link is the page as Markdown.
const docs = new URL('../src/content/docs/', import.meta.url)

/** The page ids of a Starlight sidebar, in order. */
export function sidebarIds(items) {
  return items.flatMap((item) => (typeof item === 'string' ? [item] : sidebarIds(item.items ?? [])))
}

/** The ids of every page but the home page. */
export function pageIds() {
  return readdirSync(docs, { recursive: true }).filter((name) => /\.mdx?$/.test(name) && !name.startsWith('index.')).map((name) => name.replace(/\.mdx?$/, '')).sort()
}

/** The title and description in a page's front matter. */
export function frontMatter(id) {
  const file = readdirSync(docs, { recursive: true }).find((name) => name === `${id}.md` || name === `${id}.mdx`)
  if (!file) throw new Error(`The sidebar names ${id}, which is not a page`)
  const head = /^---\n([\s\S]*?)\n---/.exec(readFileSync(new URL(file, docs), 'utf8'))?.[1] ?? ''
  const field = (name) => new RegExp(`^${name}: (.+)$`, 'm').exec(head)?.[1].trim().replace(/^(["'])(.*)\1$/, '$2')
  const title = field('title'), description = field('description')
  if (!title || !description) throw new Error(`${id} needs a title and a description`)
  return { title, description }
}

/** One custom set for each page of the sidebar. */
export function pageSets(sidebar) {
  return sidebarIds(sidebar).map((id) => {
    const { title, description } = frontMatter(id)
    return { label: title, description, paths: [id] }
  })
}
