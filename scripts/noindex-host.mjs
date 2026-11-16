/**
 * A host that stays out of search results (adult.renplay.org) says noindex in a header and in every page, and its
 * robots.txt lets crawlers in. A crawler that robots.txt blocks never fetches the page, so it never reads the noindex,
 * and the address can still be listed (https://developers.google.com/search/docs/crawling-indexing/block-indexing).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const pagesOf = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = join(dir, e.name)
  return e.isDirectory() ? pagesOf(full) : e.name.endsWith('.html') ? [full] : []
})

/** What is wrong with one built noindex host (its folder), as sentences. */
export function noindexProblems(dist, host) {
  const problems = []
  const read = (name) => (existsSync(join(dist, name)) ? readFileSync(join(dist, name), 'utf8') : null)

  const robots = read('robots.txt')
  if (robots === null) problems.push(`${host}: robots.txt is missing, so a crawler has no word that it may read the noindex`)
  else if (robots.split('\n').some((line) => /^\s*disallow:\s*\S/i.test(line))) problems.push(`${host}: robots.txt blocks crawling, so a crawler never reads the noindex and the address can still be listed`)

  // The rule for every path in the _headers file: "/*", then its headers indented under it.
  const rules = (read('_headers') ?? '').split('\n')
  const start = rules.findIndex((line) => line.trim() === '/*')
  const lines = start < 0 ? [] : rules.slice(start + 1)
  const end = lines.findIndex((line) => /^\S/.test(line))
  const all = end < 0 ? lines : lines.slice(0, end)
  if (!all.some((line) => /^\s*x-robots-tag:.*\bnoindex\b/i.test(line))) problems.push(`${host}: _headers has no X-Robots-Tag with noindex for every path`)

  for (const page of pagesOf(dist)) {
    const meta = readFileSync(page, 'utf8').match(/<meta\s+name="robots"\s+content="([^"]*)"/i)
    if (!meta || !/\bnoindex\b/i.test(meta[1])) problems.push(`${host}: ${relative(dist, page)} has no robots meta with noindex`)
  }
  return problems
}
