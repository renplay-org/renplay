#!/usr/bin/env node
// Writes the icons from logo/mark.svg and copies the wordmark beside them, so no icon is ever edited by hand. sharp comes from the server's packages.
//
//   node design/build.mjs [folder]    (folder: where the repository's public folders are written, the repository by default)
//
// Run it after a change to the mark, and commit what it writes.
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const here = new URL('.', import.meta.url).pathname
const sharp = createRequire(join(here, '../server/package.json'))('sharp')
const out = process.argv[2] ?? join(here, '..')
const mark = readFileSync(join(here, 'logo/mark.svg'))

const png = (size) => sharp(mark, { density: (72 * size) / 512 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

/** An .ico that holds one PNG for each size. */
const ico = async (sizes) => {
  const images = await Promise.all(sizes.map(png))
  const head = Buffer.alloc(6 + 16 * sizes.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(sizes.length, 4)
  let offset = head.length
  sizes.forEach((size, i) => {
    head.writeUInt8(size, 6 + 16 * i)
    head.writeUInt8(size, 7 + 16 * i)
    head.writeUInt16LE(1, 10 + 16 * i)
    head.writeUInt16LE(32, 12 + 16 * i)
    head.writeUInt32LE(images[i].length, 14 + 16 * i)
    head.writeUInt32LE(offset, 18 + 16 * i)
    offset += images[i].length
  })
  return Buffer.concat([head, ...images])
}

const targets = {
  'selector/public': ['favicon.svg', 'wordmark.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
  'docs/site/public': ['favicon.svg', 'wordmark.svg', 'wordmark-on-paper.svg', 'favicon.ico', 'favicon-48.png', 'apple-touch-icon.png'],
  website: ['favicon.ico', 'favicon-48.png', 'apple-touch-icon.png', 'logo.png'],
  docs: ['logo-1024.png'],
}
const sizes = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180, 'favicon-48.png': 48, 'logo-1024.png': 1024, 'logo.png': 1024 }

for (const [folder, names] of Object.entries(targets)) {
  mkdirSync(join(out, folder), { recursive: true })
  for (const name of names) {
    const file = join(out, folder, name)
    if (name === 'favicon.svg') copyFileSync(join(here, 'logo/mark.svg'), file)
    else if (name.startsWith('wordmark')) copyFileSync(join(here, 'logo', name), file)
    else if (name === 'favicon.ico') writeFileSync(file, await ico([16, 32, 48]))
    else writeFileSync(file, await png(sizes[name]))
    console.log(`${folder}/${name}`)
  }
}
