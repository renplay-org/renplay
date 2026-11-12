import { test, expect, freeze, open, openClocked, settled } from './fixtures.mjs'

async function state(page) {
  return page.locator('.carousel').evaluate((box) => ({
    offset: box.scrollLeft,
    width: box.clientWidth,
    index: [...box.querySelectorAll('.slide:not(.copy)')].findIndex((s) => !s.inert),
    active: [...box.querySelectorAll('.slide:not(.copy)')].filter((s) => !s.inert).map((s) => s.getAttribute('aria-label')),
    count: box.querySelectorAll('.slide:not(.copy)').length,
    dot: [...document.querySelectorAll('.dots .dot')].findIndex((d) => d.getAttribute('aria-current') === 'true'),
  }))
}

// One CSS pixel is the existing settlement tolerance. It covers fractional scroll rounding, not another slide.
async function landed(page, index) {
  await expect.poll(async () => {
    const s = await state(page)
    return { index: s.index, dot: s.dot, withinOnePixel: Math.abs(s.offset - (index + 1) * s.width) < 1 }
  }, { message: `Carousel lands on real slide ${index + 1}, with its dot current and offset within 1 CSS pixel` }).toEqual({ index, dot: index, withinOnePixel: true })
  const s = await state(page)
  expect(Math.round(s.offset - s.width), 'The offset rounds to the exact destination pixel').toBe(index * s.width)
  expect(s.active, 'Only the destination slide is reachable and names its index').toEqual([`${index + 1} of ${s.count}`])
}

async function record(page) {
  await page.locator('.carousel').evaluate((box) => {
    window.__offsets = [box.scrollLeft]
    box.onscroll = () => window.__offsets.push(box.scrollLeft)
  })
}

async function direction(page, sign, count) {
  await expect.poll(() => page.locator('.carousel').evaluate((box) => window.__offsets.at(-1) === box.scrollLeft), { message: 'The final jump scroll event has been recorded' }).toBe(true)
  const offsets = await page.evaluate(() => window.__offsets)
  const { width } = await state(page)
  const deltas = offsets.slice(1).map((x, i) => (x - offsets[i]) * sign)
  expect(deltas.some((d) => d > 0), 'The carousel moves in the requested direction').toBe(true)
  expect(deltas.filter((d) => d < -count * width / 2), 'Exactly one silent jump off the end copy').toHaveLength(1)
  expect(deltas.filter((d) => d < -0.01 && d >= -count * width / 2), 'No movement in the wrong direction before the silent jump').toEqual([])
}

test('Carousel: next wraps last to first, previous wraps first to last', async ({ page }, testInfo) => {
  await open(page)
  await settled(page)
  const count = await page.locator('.carousel .slide:not(.copy)').count()
  await page.locator('.dots .dot').last().click()
  await landed(page, count - 1)
  await record(page)
  if (testInfo.project.name === 'chromium-desktop') await page.getByRole('button', { name: 'Next', exact: true }).click()
  else {
    await page.locator('.carousel').focus()
    await page.keyboard.press('ArrowRight')
  }
  await landed(page, 0)
  await direction(page, 1, count)
  await record(page)
  if (testInfo.project.name === 'chromium-desktop') await page.getByRole('button', { name: 'Previous', exact: true }).click()
  else await page.keyboard.press('ArrowLeft')
  await landed(page, count - 1)
  await direction(page, -1, count)
})

test('Carousel: automatic turn is scheduled at 7000 ms, not before', async ({ page }) => {
  await freeze(page)
  await page.addInitScript(() => {
    window.__turns = []
    const timeout = window.setTimeout.bind(window)
    window.setTimeout = (fn, ms, ...args) => {
      if (ms === 7000) { window.__rotateAt = Date.now() + ms; window.__rotateFrom = Date.now() }
      return timeout(fn, ms, ...args)
    }
    const scroll = Element.prototype.scrollTo
    Element.prototype.scrollTo = function (options, ...args) {
      if (this.classList.contains('carousel') && options?.behavior === 'smooth') window.__turns.push({ left: options.left, at: Date.now() })
      return scroll.call(this, options, ...args)
    }
  })
  await openClocked(page)
  expect(await page.evaluate(() => window.__rotateAt - window.__rotateFrom), 'Autoplay schedules a seven second deadline after initialization').toBe(7000)
  // The deadline is read before the turn: once it turns, the carousel schedules the next turn and `__rotateAt` moves on.
  const deadline = await page.evaluate(() => window.__rotateAt)
  const remaining = await page.evaluate(() => window.__rotateAt - Date.now())
  await page.clock.runFor(remaining - 1)
  expect(await page.evaluate(() => window.__turns), 'No automatic turn at 6999 ms').toEqual([])
  await page.clock.runFor(1)
  expect(await page.evaluate(() => window.__turns), 'One automatic request for the next slide at exactly 7000 ms').toEqual([
    { left: 2 * (await state(page)).width, at: deadline },
  ])
})
