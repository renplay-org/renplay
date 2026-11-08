#!/usr/bin/env node
/**
 * The built website (website/dist, `sh website/build.sh`): every local link and picture in its pages
 * is a file there, a folder with an index.html, or one of the stable addresses in _redirects.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const dist = new URL('../website/dist/', import.meta.url).pathname
if (!existsSync(dist)) {
  console.error('Build the website first: sh website/build.sh')
  process.exit(1)
}

// "/docs/*  https://…" covers /docs/anything. Query strings and fragments never matter here.
const redirects = readFileSync(join(dist, '_redirects'), 'utf8').split('\n')
  .map((line) => line.trim().split(/\s+/)[0])
  .filter((from) => from && !from.startsWith('#'))
const redirected = (path) => redirects.some((from) => (from.endsWith('/*') ? path.startsWith(from.slice(0, -1)) : path === from))

const exists = (path) => {
  const full = join(dist, decodeURIComponent(path))
  if (!existsSync(full)) return existsSync(`${full}.html`)
  return statSync(full).isFile() || existsSync(join(full, 'index.html'))
}

const pages = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = join(dir, e.name)
  return e.isDirectory() ? pages(full) : e.name.endsWith('.html') ? [full] : []
})

const broken = []
for (const page of pages(dist)) {
  const html = readFileSync(page, 'utf8')
  const base = `/${relative(dist, page).replace(/(^|\/)index\.html$/, '$1')}`
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    // Addresses the pages' scripts fill in (${…}) are checked by reading.
    if (!url || url.includes('${') || /^(https?:|mailto:|data:|#|javascript:)/.test(url)) continue
    const path = new URL(url, `https://renplay.org${base}`).pathname
    if (!exists(path) && !redirected(path)) broken.push(`${relative(dist, page)}: ${url}`)
  }
}

if (broken.length) {
  console.error(`Links to nothing in the website:\n${broken.join('\n')}`)
  process.exit(1)
}
console.log('Every link in the website leads somewhere.')
