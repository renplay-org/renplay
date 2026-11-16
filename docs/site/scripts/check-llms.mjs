// The built docs (dist/, `npm run build`) have an llms.txt that lists every page on a line of its own, with its
// description, and each link in it leads to a file of the build. Nothing in it points to the adult site.
import { existsSync, readFileSync } from 'node:fs'
import { frontMatter, pageIds } from './llms-sets.mjs'

const dist = new URL('../dist/', import.meta.url)
const site = 'https://docs.renplay.org/'
const problems = []
const read = (name) => (existsSync(new URL(name, dist)) ? readFileSync(new URL(name, dist), 'utf8') : (problems.push(`${name} is missing`), ''))

const llms = read('llms.txt')
for (const name of ['llms-small.txt', 'llms-full.txt']) read(name)
const lines = llms.split('\n')

for (const id of pageIds()) {
  const { title, description } = frontMatter(id)
  const line = lines.find((l) => l.startsWith(`- [${title}](`))
  if (!line) problems.push(`llms.txt does not list ${id} (${title})`)
  else if (!line.endsWith(`: ${description}`)) problems.push(`llms.txt gives ${id} another description than its page`)
}
for (const [, url] of llms.matchAll(/\]\(([^)]+)\)/g)) {
  if (!url.startsWith(site)) problems.push(`llms.txt links outside the docs: ${url}`)
  else if (!existsSync(new URL(url.slice(site.length), dist))) problems.push(`llms.txt links to a file the build does not have: ${url}`)
}
if (/adult\.renplay\.org/i.test(llms)) problems.push('llms.txt names the adult site')

if (problems.length) {
  console.error(`llms.txt is not right:\n${problems.join('\n')}`)
  process.exit(1)
}
console.log(`llms.txt lists ${pageIds().length} pages and every link in it leads to a file.`)
