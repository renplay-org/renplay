// Once a search has put the toolbar under the header, nothing of the page reads in the band from the top of the screen to
// the bottom of the toolbar, at rest and at scrolls where tiles pass under it: the header and the toolbar are one solid
// area of ink, and what passes under it is gone. At the top of the page, with no search, the area is not there.
import sharp from 'sharp'
import { test, expect, check, until } from '../fixtures.mjs'
import { fieldOf, ready, SEARCH_PAGES } from '../helpers.mjs'


test.use({ mockOptions: {} })

/**
 * How readable the page is through the band: the sharpest edge in the difference between the band as it is and the band
 * with everything in the page but the toolbar hidden (0 to 255, from one pixel to the next). Text that shows through,
 * even faintly, makes edges of tens. A soft shape, a blurred picture or a tint makes edges of a few.
 */
async function sharpest(a, b) {
  const [x, y] = await Promise.all([a, b].map((png) => sharp(png).raw().toBuffer({ resolveWithObject: true })))
  const { width, height, channels } = x.info
  if (width !== y.info.width || height !== y.info.height) return Infinity
  const diff = new Float32Array(width * height)
  for (let i = 0; i < diff.length; i++) {
    let sum = 0
    for (let c = 0; c < 3; c++) sum += Math.abs(x.data[i * channels + c] - y.data[i * channels + c])
    diff[i] = sum / 3
  }
  let most = 0
  for (let row = 0; row < height - 1; row++)
    for (let col = 0; col < width - 1; col++) {
      const at = row * width + col
      most = Math.max(most, Math.abs(diff[at + 1] - diff[at]), Math.abs(diff[at + width] - diff[at]))
    }
  return most
}

/** The most that may show of the page in the band, as `sharpest` measures it. Without the solid area the edges are above 100. */
const FAINT = 20

const nextFrames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))

for (const [name, path, field, , letter] of SEARCH_PAGES) {
  test(`${name}: nothing of the page reads between the top of the screen and the bottom of the toolbar`, async ({ page }, testInfo) => {
    const glass = () => page.evaluate(() => { const v = document.querySelector('.toolbar-glass'); return { stuck: v.hasAttribute('data-stuck'), opacity: Number(getComputedStyle(v).opacity) } })
    const settle = () => page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'))
    // The rows above the toolbar, in the toolbar's own parent: whether any is visible, and where the toolbar is. The header is solid once the page has scrolled.
    const above = () => page.evaluate(() => {
      const toolbar = document.querySelector('.toolbar[role="search"]')
      const rows = [...toolbar.parentElement.children].filter((e) => e.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING && !e.matches('.toolbar-top, .toolbar-glass'))
      return { rows: rows.length, visible: rows.filter((e) => getComputedStyle(e).visibility !== 'hidden' && Number(getComputedStyle(e).opacity) > 0).length, top: toolbar.getBoundingClientRect().top, solid: getComputedStyle(document.querySelector('.top'), '::after').opacity === '1' }
    })
    await ready(page, path)
    const rest = await glass()
    const rows = await above()
    check(!rest.stuck && rest.opacity === 0 && rows.rows > 0 && rows.visible === rows.rows, `${name}: at the top of the page the header and the page look as they did, with no glass and the rows above the toolbar in place`)
    await fieldOf(page, field).click()
    await page.keyboard.type(letter)
    await page.waitForFunction(() => document.querySelector('.toolbar-glass')?.hasAttribute('data-stuck'))
    await settle()
    // The toolbar stays where it is: the glass is no part of the layout.
    const parkedAt = await page.evaluate(() => ({ y: scrollY, top: document.querySelector('.toolbar[role="search"]').getBoundingClientRect().top }))
    await page.evaluate(() => document.activeElement?.blur())
    const bad = []
    for (const offset of [0, 140, 420, 1300]) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), parkedAt.y + offset)
      await nextFrames(page)
      await settle()
      const clip = await page.evaluate(() => {
        // To the bottom of the solid area, whole pixels: the hairline under it is not in the band, and a toolbar a hundredth of a pixel lower than its place does not move it.
        return { x: 0, y: 0, width: innerWidth, height: Math.floor(document.querySelector('.toolbar-glass').getBoundingClientRect().bottom) }
      })
      const shown = await page.screenshot({ clip, scale: 'css' })
      const style = await page.addStyleTag({ content: 'main :not(.toolbar):not(.toolbar *):not(.toolbar-glass) { visibility: hidden !important } .toolbar, .toolbar *, .toolbar-glass { visibility: visible !important }' })
      const bare = await page.screenshot({ clip, scale: 'css' })
      await style.evaluate((el) => el.remove())
      const edge = await sharpest(shown, bare)
      const state = await glass()
      const rows = await above()
      if (edge > FAINT || !state.stuck || state.opacity !== 1 || !rows.solid) bad.push(`at ${offset} px: edges of ${edge.toFixed(0)} show${state.stuck ? '' : ', no glass'}${rows.solid ? '' : ', the header is not solid'}`)
    }
    check(!bad.length, `${name}: nothing of the page reads between the top of the screen and the bottom of the toolbar, at rest and with tiles passing under it${bad.length ? ` (${bad.join('; ')})` : ''}`)
    const after = await page.evaluate(() => document.querySelector('.toolbar[role="search"]').getBoundingClientRect().top)
    check(Math.abs(after - parkedAt.top) <= 1, `${name}: the toolbar stays under the header while the glass is on (${Math.round(parkedAt.top)} then ${Math.round(after)} px)`)
    // With the search cleared and the page back at the top the toolbar is not stuck, and the glass goes. The page keeps the
    // toolbar where it is for half a second after the shelves come back: the top is asked for until it holds.
    // On a phone the field is closed (it was blurred above): the search is cleared by its word.
    await page.click(testInfo.project.use.hasTouch ? '.search-kept' : '.search-field .clear')
    let gone
    let back
    await until(async () => {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await nextFrames(page)
      gone = await glass()
      back = await above()
      return !gone.stuck && gone.opacity === 0 && back.visible === back.rows
    }, `${name}: the glass goes and the rows above the toolbar come back when the toolbar is no longer stuck`)
    await settle()
    gone = await glass()
    back = await above()
    check(!gone.stuck && gone.opacity === 0 && back.visible === back.rows, `${name}: the glass goes and the rows above the toolbar come back when the toolbar is no longer stuck`)
  })
}
