import sharp from 'sharp'

/** The sides of a box (in CSS pixels) where the white focus ring 2 to 4 px outside it is not there. */
export async function ringAt(page, box) {
  const margin = 8
  const clip = { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin }
  const { data, info } = await sharp(await page.screenshot({ clip, scale: 'css' })).raw().toBuffer({ resolveWithObject: true })
  const px = (x, y) => {
    const i = (Math.round(y) * info.width + Math.round(x)) * info.channels
    return Math.min(data[i], data[i + 1], data[i + 2])
  }
  const at = (d) => d + margin
  const w = box.width, h = box.height
  const points = []
  for (const f of [0.25, 0.5, 0.75]) points.push(['top', px(margin + w * f, at(-3))], ['bottom', px(margin + w * f, at(h + 3))])
  for (const f of [0.45, 0.5, 0.55]) points.push(['left', px(at(-3), margin + h * f)], ['right', px(at(w + 3), margin + h * f)])
  // Whole is white, cut is dark. Half way is the ring's edge on a fractional pixel.
  return points.filter(([, v]) => v < 128).map(([side]) => side)
}

/**
 * The sides of a box where the white focus ring is cut off, for a ring drawn inside the box (a row in a
 * list that scrolls) or around it (a pill). A side passes when the line 1 px inside or 3 px outside its
 * middle is white. A clipped ring is dark at both.
 */
export async function ringShown(page, box) {
  const margin = 8
  const clip = { x: Math.max(0, box.x - margin), y: Math.max(0, box.y - margin), width: box.width + 2 * margin, height: box.height + 2 * margin }
  const { data, info } = await sharp(await page.screenshot({ clip, scale: 'css' })).raw().toBuffer({ resolveWithObject: true })
  const left = box.x - clip.x, top = box.y - clip.y
  const px = (x, y) => {
    const i = (Math.floor(y) * info.width + Math.floor(x)) * info.channels
    return Math.min(data[i], data[i + 1], data[i + 2])
  }
  const white = (...points) => points.some(([x, y]) => px(left + x, top + y) >= 128)
  const w = box.width, h = box.height
  const missing = []
  // The box may sit on half a pixel, which halves the ring's pixels there: each side is read at a few depths.
  const insides = [0.5, 1, 1.5], outsides = [2.5, 3, 3.5]
  for (const f of [0.4, 0.5, 0.6]) {
    if (!white(...insides.map((d) => [w * f, d]), ...outsides.map((d) => [w * f, -d]))) missing.push('top')
    if (!white(...insides.map((d) => [w * f, h - d]), ...outsides.map((d) => [w * f, h + d]))) missing.push('bottom')
  }
  // The ends are read at the middle only: a pill's ends are round, and its ring turns away from the box's corners.
  if (!white(...insides.map((d) => [d, h / 2]), ...outsides.map((d) => [-d, h / 2]))) missing.push('left')
  if (!white(...insides.map((d) => [w - d, h / 2]), ...outsides.map((d) => [w + d, h / 2]))) missing.push('right')
  return [...new Set(missing)]
}
