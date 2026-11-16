import { test, expect, open, settled, only, where } from './fixtures.mjs'
import { recordGhost, takeGhost } from './helpers.mjs'

// The tile is the website's shelf card (lantern/Tile.css, lantern/lean.ts): a border and a sheen in the game's colour,
// and under the hand a tilt and a lift with the colour's long shadow. Every tile in view leans toward the hand over its grid, as the
// website's shelf does, and the one under it lifts. Each test says an end state of the tile.

/** What the eye sees of a tile: its tilt and lift, its shadow, its sheen and its border. */
const look = (card) =>
  card.evaluate((el) => {
    const tilt = getComputedStyle(el.querySelector('.tilt'))
    const frame = el.querySelector('.frame')
    const style = getComputedStyle(frame)
    return {
      tilted: tilt.transform !== 'none',
      lifted: tilt.translate !== 'none',
      shadow: style.boxShadow,
      sheen: getComputedStyle(el.querySelector('.sheen')).opacity,
      border: `${style.borderTopWidth} ${style.borderTopColor}`,
      pressed: el.hasAttribute('data-press'),
    }
  })

/** Its transitions are done: what is seen now is the end state (read twice, a moment apart, and the same). */
async function arrived(card) {
  let before = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await look(card))
    const same = now === before
    before = now
    await card.page().waitForTimeout(120)
    return same
  }, { message: 'The tile has stopped changing' }).toBe(true)
}

/** The person's own Settings page (an admin's has the server's panels, which the mock has no answers for). */
const asPerson = (page) =>
  page.route('**/api/me', (r) =>
    r.fulfill({ json: { user: { id: 2, username: 'kuba', name: 'Kuba', role: 'player', disabled: 0, created_at: '2026-01-01T00:00:00.000Z', prefs: '{}', avatar: '', adult_ceiling: 'off', adult_choice: 'off', hasPin: false }, auth: true, demo: false, unclaimed: false, hasPassword: true } }),
  )

const mouseOnly = (testInfo) => test.skip(testInfo.project.use.hasTouch, 'A mouse')
const touchOnly = (testInfo) => test.skip(!testInfo.project.use.hasTouch, 'A finger')

/** The tiles of the grid, with the first row brought under the header. */
async function grid(page) {
  await open(page)
  await settled(page)
  // At once, not the page's smooth scroll: a check that starts while it is still moving reads a tile on its way.
  await page.evaluate(() => window.scrollTo({ top: document.querySelector('.grid[data-row]').getBoundingClientRect().top + scrollY - 140, behavior: 'instant' }))
  // The tiles learn which of them are in view from an observer, in the frame after a scroll: one that has not reported yet
  // lets go of a press that comes first. This waits for that frame, as the tiles' own observer does.
  await page.evaluate(() => new Promise((done) => {
    const watch = new IntersectionObserver(() => requestAnimationFrame(() => { watch.disconnect(); done() }))
    watch.observe(document.body)
  }))
  return page.locator('.grid[data-row] .card')
}

/** The pointer comes in from the side and stops on a tile's right half, as a hand does. */
async function rest(page, card) {
  const box = await card.boundingBox()
  await page.mouse.move(box.x - 30, box.y + 60)
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.3, { steps: 10 })
}

test('Tiles: the tile under the mouse is tilted and lit, the others at rest are not', async ({ page }, testInfo) => {
  mouseOnly(testInfo)
  const cards = await grid(page)
  const under = cards.nth(0)
  const far = cards.nth(5)
  const calm = await look(under)
  expect(calm.tilted || calm.lifted, 'Before the mouse comes, no tile is tilted or lifted').toBe(false)
  expect(calm.border, 'A tile has a border of 1 px in its own colour').toMatch(/^1px /)
  const restShadow = calm.shadow
  await rest(page, under)
  await expect.poll(async () => (await look(under)).tilted, { message: 'The tile under the mouse tilts' }).toBe(true)
  await arrived(under)
  const lit = await look(under)
  expect(lit.lifted, 'It lifts').toBe(true)
  expect(lit.shadow, 'It casts the colour of its art, which a tile at rest does not').not.toBe(restShadow)
  // The sheen eases in: its end state, read until it is there, not one sample of the way.
  await expect.poll(async () => (await look(under)).sheen, { message: 'Its sheen is whole' }).toBe('1')
  expect((await look(cards.nth(2))).sheen, 'The sheen of a tile that is not under the mouse is faint').toBe('0.55')
  const away = await look(far)
  expect(away.lifted, 'A tile far from the mouse does not lift').toBe(false)
  expect(away.shadow, 'Its shadow is the one at rest').toBe(restShadow)
  expect(away.sheen, 'Its sheen is the faint one').toBe('0.55')
  // It leans toward the mouse, as every tile in a grid does. The mouse is to its left.
  expect(await far.locator('.tilt').evaluate((el) => el.style.transform), 'A tile far from the mouse leans toward it').toMatch(/rotateY\(-[0-9.]+deg\)/)
  // The lean stops when the mouse rests: it has come to its place, and nothing changes any more.
  const tilt = () => under.locator('.tilt').evaluate((el) => el.style.transform)
  let before = ''
  await expect.poll(async () => {
    const now = await tilt()
    const same = now === before
    before = now
    await page.waitForTimeout(150)
    return same
  }, { message: 'The tile comes to its place' }).toBe(true)
  await page.waitForTimeout(400)
  expect(await tilt(), 'A resting mouse leaves the tile where it is').toBe(before)
  // And a mouse that leaves lets every tile go back.
  await page.mouse.move(720, 4)
  await expect.poll(async () => (await look(under)).tilted || (await look(under)).lifted, { message: 'The tile goes back to rest when the mouse is gone' }).toBe(false)
  expect((await look(under)).shadow).toBe(restShadow)
})

test('Tiles: reduced motion keeps the border, the glow and the sheen and takes the tilt and the lift away', async ({ page }, testInfo) => {
  mouseOnly(testInfo)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const cards = await grid(page)
  const under = cards.nth(0)
  const restShadow = (await look(under)).shadow
  await rest(page, under)
  await expect.poll(async () => (await look(under)).sheen, { message: 'The sheen is whole under the mouse' }).toBe('1')
  await arrived(under)
  const lit = await look(under)
  expect(lit.shadow, 'The glow is there').not.toBe(restShadow)
  expect(lit.border, 'So is the border').toMatch(/^1px /)
  await page.waitForTimeout(300)
  for (let i = 0; i < 6; i++) {
    const l = await look(cards.nth(i))
    expect(l.tilted || l.lifted, `Tile ${i} does not move`).toBe(false)
  }
})

test('Tiles: the focused tile is lifted and lit with the white ring, and is not tilted', async ({ page }, testInfo) => {
  only(testInfo, 'chromium-desktop', 'The focus is set here, with the key a keyboard or a controller sends: no engine or screen shows another')
  const cards = await grid(page)
  const tile = cards.nth(1)
  const restShadow = (await look(tile)).shadow
  await tile.evaluate((el) => el.focus({ focusVisible: true, preventScroll: true }))
  expect(await tile.evaluate((el) => el.matches(':focus-visible')), 'Focus is the keyboard or a controller').toBe(true)
  await expect.poll(async () => (await look(tile)).lifted, { message: 'The focused tile lifts' }).toBe(true)
  await arrived(tile)
  const lit = await look(tile)
  expect(lit.tilted, 'With no pointer it does not tilt').toBe(false)
  await expect.poll(async () => (await look(tile)).sheen, { message: 'Its sheen is whole' }).toBe('1')
  expect(lit.shadow, 'It glows').not.toBe(restShadow)
  await expect.poll(async () => (await look(tile)).shadow, { message: 'The white ring is there' }).toContain('rgb(255, 255, 255)')
  expect((await look(cards.nth(2))).lifted, 'The next tile stays down').toBe(false)
})

test('Tiles: only the cover moves under the mouse, and nothing dark is drawn on or around it', async ({ page }, testInfo) => {
  mouseOnly(testInfo)
  const cards = await grid(page)
  const under = cards.nth(0)
  const text = (card) => card.evaluate((el) => {
    const title = el.querySelector('.ct').getBoundingClientRect()
    const meta = el.querySelector('.cm')?.getBoundingClientRect() ?? title
    return { top: title.top, left: title.left, meta: meta.top, held: !!el.querySelector('.tilt .ct, .tilt .cm'), transform: getComputedStyle(el.querySelector('.ct')).transform }
  })
  const before = await text(under)
  expect(before.held, 'The title and the line under it are not in the layer that leans').toBe(false)
  await rest(page, under)
  await expect.poll(async () => (await look(under)).tilted, { message: 'The cover tilts' }).toBe(true)
  await arrived(under)
  expect((await look(under)).lifted, 'And lifts').toBe(true)
  const after = await text(under)
  expect(after, 'The title and the meta have not moved by a pixel, and have no transform').toEqual(before)
  const dark = await under.evaluate((el) => {
    const frame = getComputedStyle(el.querySelector('.frame'))
    return { shadow: frame.boxShadow, ground: frame.backgroundColor, tint: getComputedStyle(el).getPropertyValue('--tint').trim() }
  })
  expect(dark.shadow, 'The lit cover has the colour of its art in its shadow and no black ring').not.toMatch(/rgba?\(0, 0, 0/)
  expect(await look(cards.nth(5)).then((l) => l.shadow), 'A cover at rest draws no shadow of its own: its glow is the tile\'s own light').toBe('none')
  expect(dark.ground, 'What shows behind the picture is the game\'s colour, not black').not.toMatch(/^rgba?\(([0-3]), ?([0-3]), ?([0-3])/)
})

test('Tiles: Move cards with the pointer off keeps the border, the glow and the sheen and takes the tilt and the lift away', async ({ page }, testInfo) => {
  mouseOnly(testInfo)
  await asPerson(page)
  await page.goto('/settings')
  const move = page.getByRole('switch', { name: 'Move cards with the pointer' })
  await expect(move, 'The switch is on until it is turned off').toHaveAttribute('aria-checked', 'true')
  await move.click()
  await expect(move).toHaveAttribute('aria-checked', 'false')
  expect(await page.evaluate(() => localStorage.getItem('renplay:card-motion')), 'The choice is kept in this browser').toBe('0')
  const cards = await grid(page)
  const under = cards.nth(0)
  const restShadow = (await look(under)).shadow
  await rest(page, under)
  await expect.poll(async () => (await look(under)).sheen, { message: 'The sheen is whole under the mouse' }).toBe('1')
  await arrived(under)
  const lit = await look(under)
  expect(lit.shadow, 'The glow is there').not.toBe(restShadow)
  expect(lit.border, 'So is the border').toMatch(/^1px /)
  await page.waitForTimeout(300)
  for (let i = 0; i < 6; i++) {
    const l = await look(cards.nth(i))
    expect(l.tilted || l.lifted, `Tile ${i} does not move`).toBe(false)
  }
  // The same switch, turned on again, lets the tile under the mouse tilt.
  await page.goto('/settings')
  await page.getByRole('switch', { name: 'Move cards with the pointer' }).click()
  const again = await grid(page)
  await rest(page, again.nth(0))
  await expect.poll(async () => (await look(again.nth(0))).tilted, { message: 'On again, the tile under the mouse tilts' }).toBe(true)
  await arrived(again.nth(0))
  expect((await look(again.nth(0))).lifted, 'And lifts').toBe(true)
})

test('Tiles: reduced motion keeps the tiles still whatever the switch says', async ({ page }, testInfo) => {
  mouseOnly(testInfo)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await asPerson(page)
  await page.goto('/settings')
  await expect(page.getByRole('switch', { name: 'Move cards with the pointer' }), 'The switch is on').toHaveAttribute('aria-checked', 'true')
  const cards = await grid(page)
  await rest(page, cards.nth(0))
  await expect.poll(async () => (await look(cards.nth(0))).sheen, { message: 'The sheen is whole under the mouse' }).toBe('1')
  await page.waitForTimeout(300)
  const l = await look(cards.nth(0))
  expect(l.tilted || l.lifted, 'It does not move').toBe(false)
})

test('Tiles: a press leans the tile toward the finger and back, and scrolling moves nothing', async ({ page }, testInfo) => {
  where(testInfo, ['webkit-portrait'], "A finger's lean is the same in landscape")
  touchOnly(testInfo)
  const cards = await grid(page)
  const tile = cards.nth(1)
  const tilt = tile.locator('.tilt')
  const at = await tile.boundingBox()
  const send = (type) =>
    tile.evaluate((el, [kind, b]) => el.dispatchEvent(new PointerEvent(kind, { pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: b.x + b.width * 0.85, clientY: b.y + b.height * 0.8, bubbles: true })), [type, at])
  await send('pointerdown')
  await expect.poll(async () => (await look(tile)).tilted, { message: 'A press leans the tile' }).toBe(true)
  const leaning = await tilt.evaluate((el) => el.style.transform)
  expect(leaning, 'It leans toward a finger at its lower right').toMatch(/rotateY\([0-9.]+deg\) rotateX\(-[0-9.]+deg\)/)
  await arrived(tile)
  await expect.poll(async () => { const lit = await look(tile); return lit.pressed && lit.sheen === '1' }, { message: 'It is lit while pressed' }).toBe(true)
  await send('pointerup')
  await expect.poll(async () => (await look(tile)).tilted || (await look(tile)).pressed, { message: 'It leans back when the finger lifts' }).toBe(false)
  // Scrolling moves no tile.
  await page.evaluate(() => window.scrollBy(0, 260))
  await page.waitForTimeout(300)
  const moved = await page.locator('.grid[data-row] .card .tilt').evaluateAll((els) => els.filter((el) => el.style.transform !== '').length)
  expect(moved, 'No tile is tilted after a scroll').toBe(0)
})

test('Tiles: the flight lands on a tile at rest', async ({ page }, testInfo) => {
  mouseOnly(testInfo)
  const cards = await grid(page)
  const id = await cards.nth(2).getAttribute('data-id')
  const tile = page.locator(`.grid[data-row] .card[data-id="${id}"]`)
  await rest(page, tile)
  await expect.poll(async () => (await look(tile)).tilted, { message: 'The mouse leaves the tile tilted and lifted' }).toBe(true)
  await tile.click()
  await expect(page).toHaveURL(/\/game\//)
  await settled(page)
  // The picture of the flight forward is gone: the one noted below is the one back.
  await expect(page.locator('.ghost')).toHaveCount(0)
  // Where the picture's animation ends, and what the tile it lands on is while it flies: noted the moment the picture is added
  // to the page and on every frame, so a machine that draws no frame during the flight still shows both.
  await recordGhost(page)
  await page.evaluate(() => {
    window.__rests = []
    const watch = () => {
      const card = document.querySelector('.grid[data-row] .card[data-rest]')
      if (!document.querySelector('.ghost') || !card) return
      const t = getComputedStyle(card.querySelector('.tilt'))
      window.__rests.push(t.transform === 'none' && t.translate === 'none')
    }
    new MutationObserver(watch).observe(document.body, { childList: true, subtree: true })
    const frame = () => {
      watch()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await page.goBack()
  await expect(page.locator('.grid[data-row] .card').first()).toBeAttached()
  const flown = await takeGhost(page)
  expect(flown.frames.length, 'The picture flew back to its tile').toBeGreaterThan(0)
  const rests = await page.evaluate(() => window.__rests)
  expect(rests.length, 'The tile it lands on is marked at rest while the picture flies').toBeGreaterThan(0)
  expect(rests.every(Boolean), 'It has no tilt and no lift while the picture flies').toBe(true)
  const place = await page.locator(`.grid[data-row] .card[data-id="${id}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width }
  })
  expect(Math.abs(flown.end.x - place.x), 'The picture ends at the tile, from the left').toBeLessThan(2)
  expect(Math.abs(flown.end.y - place.y), 'From the top').toBeLessThan(2)
  expect(Math.abs(flown.end.width - place.w), 'And as wide').toBeLessThan(2)
  await expect(page.locator('.grid[data-row] .card[data-rest]'), 'The tile is let go of when the picture lands').toHaveCount(0)
})

test('Tiles: an adult tile at Blurred keeps its blur, and its glow is its colour, not its picture', async ({ page }, testInfo) => {
  mouseOnly(testInfo)
  const asked = []
  page.on('request', (r) => asked.push(new URL(r.url()).pathname))
  await page.route('**/api/me/adult', (r) => r.fulfill({ json: { installation: { level: 'blurred', fixed: false, chosen: true }, ceiling: { level: 'blurred', managed: null }, choice: 'blurred', effective: 'blurred' } }))
  await page.addInitScript(() => {
    const get = window.fetch
    window.fetch = async (...a) => {
      const r = await get(...a)
      if (new URL(typeof a[0] === 'string' ? a[0] : a[0].url, location.href).pathname !== '/api/games') return r
      const body = await r.json()
      // Its art carries no address at Blurred, as the server sends it.
      for (const g of body.games) if (g.id === 'game-001') { g.nsfw = true; for (const k of Object.keys(g.art)) g.art[k].url1x = null }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  const cards = await grid(page)
  const adult = cards.nth(1)
  await expect(adult.locator('.tag18'), 'The 18+ mark is on the tile').toBeVisible()
  await expect(adult.locator('img.art'), 'No picture is in the tile').toHaveCount(0)
  await rest(page, adult)
  await expect.poll(async () => (await look(adult)).tilted, { message: 'The adult tile leans like any other' }).toBe(true)
  await arrived(adult)
  const lit = await look(adult)
  expect(lit.sheen, 'And is lit').toBe('1')
  await rest(page, cards.nth(3))
  await arrived(cards.nth(3))
  expect(lit.shadow, 'Its glow is the colour of the game, the same as another game of that colour').toBe((await look(cards.nth(3))).shadow)
  expect(asked.filter((p) => p.includes('game-001-')), 'No picture of it was asked for').toEqual([])
})
