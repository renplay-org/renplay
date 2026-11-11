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
