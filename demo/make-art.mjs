// Makes The Question's art for the demo's recipe from the game's own pictures (MIT, like Ren'Py):
// a 600x900 poster, a 1920x620 background and a logo. Run once, with sharp from the server:
//
//   node demo/make-art.mjs <the_question/game/images> demo/recipes/art/the-question
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(new URL('../../server/package.json', import.meta.url))
const sharp = require('sharp')
const [images, out] = process.argv.slice(2)
if (!images || !out) {
  console.error('Usage: node demo/make-art.mjs <the_question/game/images> <out dir>')
  process.exit(1)
}
const bg = join(images, 'bg meadow.jpg')
const sylvie = join(images, 'sylvie green smile.png')
const title = (w, h, size, anchor = 'middle', x = w / 2) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><filter id="s" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="${size / 18}" stdDeviation="${size / 12}" flood-color="#1b2a4a" flood-opacity=".75"/></filter></defs>
    <text x="${x}" y="${h * 0.72}" text-anchor="${anchor}" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-weight="700" font-size="${size}" fill="#ffffff" filter="url(#s)">The Question</text>
  </svg>`)

// Poster: the meadow's sky and trees, Sylvie in front, the title in the sky.
const poster = await sharp(bg).resize(600, 900, { fit: 'cover', position: 'left' }).toBuffer()
const girl = await sharp(sylvie).resize({ height: 760 }).toBuffer()
const gm = await sharp(girl).metadata()
await sharp(poster)
  .composite([
    { input: girl, left: Math.round((600 - gm.width) / 2), top: 900 - 760 + 40 },
    { input: title(600, 200, 76), left: 0, top: 30 },
  ])
  .webp({ quality: 88 })
  .toFile(join(out, 'grid.webp'))

// Background: the meadow across, Sylvie at the right, where the page has no text.
const hero = await sharp(bg).resize(1920, 620, { fit: 'cover', position: 'centre' }).toBuffer()
// Waist up: 900 px tall, the top 580 px of her on the 620 px background.
const tall = await sharp(sylvie).resize({ height: 900 }).toBuffer()
const tm = await sharp(tall).metadata()
const half = await sharp(tall).extract({ left: 0, top: 0, width: tm.width, height: 580 }).toBuffer()
const hm = { width: tm.width }
await sharp(hero)
  .composite([{ input: half, left: Math.round(1920 * 0.72 - hm.width / 2), top: 40 }])
  .webp({ quality: 86 })
  .toFile(join(out, 'hero.webp'))

// Logo: the title alone, on transparency.
await sharp(title(1120, 220, 150)).png().toFile(join(out, 'logo.png'))
console.log('grid.webp, hero.webp and logo.png in', out)
