// What the app's browser checks share: serving the built library, the way a check reports, the helpers
// the checks use on a page, and `main`, which runs the checks of the files it is given in parallel.
//
// Every check file runs on its own (`node scripts/app-ui/carousel.mjs`), and check-app-ui.mjs runs them all.
//   --base http://localhost:5199   use a running library instead of serving selector/dist
//   --webkit                       the phone checks in WebKit as well (needs `npx playwright install webkit`)
//   --only a,b                     just the checks with these names (the name is the one in the file's list of tasks)
//   --jobs 6                       how many checks run at once (4 by default)
//   --trace /tmp/app-traces         traces and scroll calls, including when a task stops
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices, webkit } from 'playwright'

import { serveDist } from './serve.mjs'

export const desktop = { viewport: { width: 1440, height: 900 } }
export const phoneChromium = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }

// ---- reporting ----------------------------------------------------------------------------------

/** The task whose checks are being made: what it says is printed in one piece when it ends. */
const running = new AsyncLocalStorage()
const failures = []
let checks = 0

export const check = (ok, what) => {
  checks++
  running.getStore()?.lines.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

// ---- helpers on a page --------------------------------------------------------------------------

export const gridOf = (page) =>
  page.evaluate(() => {
    const grid = document.querySelector('.grid[data-row]')
    return grid ? { tiles: grid.children.length, cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length } : null
  })

/** Scroll to the end of the grid until it stops growing, or `batches` batches came. Every size seen is returned. */
export async function growBy(page, batches) {
  const sizes = []
  for (let guard = 0; guard < 40 && sizes.length <= batches; guard++) {
    const g = await gridOf(page)
    if (!g) break
    if (sizes.at(-1)?.tiles !== g.tiles) sizes.push(g)
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForTimeout(90)
  }
  return sizes
}

/**
 * The flying picture as the page shows it, and where its animation ends (the last keyframe, since the last frame seen
 * may be a few hundredths of a second short of it): its shape and place. It is noted the moment it is added to the page,
 * so a flight is seen on a machine too slow to draw a frame during it, and on every frame after that.
 */
export const recordGhost = (page) =>
  page.evaluate(() => {
    window.__ghost = []
    window.__end = null
    const note = (el) => {
      const r = el.getBoundingClientRect()
      window.__ghost.push({ w: r.width, h: r.height, x: r.x, y: r.y })
      if (!window.__end) {
        const last = el.getAnimations()[0]?.effect.getKeyframes().at(-1)
        const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(last?.transform ?? '')
        if (m) window.__end = { x: +m[1], y: +m[2], width: el.offsetWidth * +m[3] }
      }
    }
    window.__added = new MutationObserver((list) => {
      for (const m of list) for (const el of m.addedNodes) if (el.classList?.contains('ghost')) note(el)
    })
    window.__added.observe(document.body, { childList: true })
    const tick = () => {
      const el = document.querySelector('.ghost')
      if (el) note(el)
      window.__recording = requestAnimationFrame(tick)
    }
    window.__recording = requestAnimationFrame(tick)
  })
/** The frames recorded, once the flying picture has been seen (the page makes it a frame or more after the page shows) and has landed. */
export const takeGhost = async (page) => {
  await page.waitForFunction(() => window.__ghost.length > 0, null, { timeout: 10000 }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('.ghost'), null, { timeout: 5000 })
  return page.evaluate(() => {
    cancelAnimationFrame(window.__recording)
    window.__added.disconnect()
    return { frames: window.__ghost, end: window.__end }
  })
}

// Every picture seen keeps 2:3, and one was seen: how many frames a slow machine draws during a short flight is not for a check.
export const shapeOk = (frames) => frames.length >= 1 && frames.every((f) => Math.abs(f.h / f.w - 1.5) < 0.02)

/** Waits until the game page is on screen and the list it came from is gone: the stage of the Library's carousel is not the game's. */
export const onGamePage = (page) => page.waitForFunction(() => location.pathname.startsWith('/game/') && !document.querySelector('.grid[data-row]') && document.querySelector('main .stage'))

/** Whether the screen is a phone's. */
export const isPhone = (options) => (options.viewport?.width ?? 1440) < 720 || !!options.isMobile

// ---- the search pages ---------------------------------------------------------------------------

// The page, its path, the field's label, the words its made-up titles start with, a letter in them, one title in full.
export const SEARCH_PAGES = [
  ['the Library', '/', 'Search your games', 'Game', 'g', 'Game 125'],
  ['the Catalog', '/catalog', 'Search the catalog', 'Recipe', 'r', 'Recipe 119'],
]
export const fieldOf = (page, label) => page.locator(`input[aria-label="${label}"]`)
/** Waits for the grid, and for the page's first fade and the room's crossfade (it drops the old layer after 650 ms) to be over. */
export const ready = async (page, base, path) => {
  await page.goto(base + path)
  await page.waitForSelector('.grid[data-row] .card')
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished') && document.querySelectorAll('.bd .l').length <= 1)
}
/** Waits until the page has not scrolled for a moment, or for a few seconds at most. */
export const quiet = (page, ms = 250) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        let timer = setTimeout(finish, ms)
        const stop = setTimeout(finish, 5000)
        const bump = () => {
          clearTimeout(timer)
          timer = setTimeout(finish, ms)
        }
        function finish() {
          clearTimeout(timer)
          clearTimeout(stop)
          window.removeEventListener('scroll', bump)
          done()
        }
        window.addEventListener('scroll', bump, { passive: true })
      }),
    ms,
  )
/** Waits for the page to have scrolled to the toolbar under the header and to be still there. */
export const parked = async (page) => {
  await page.waitForFunction(
    () => {
      const toolbar = document.querySelector('.toolbar[role="search"]')
      const style = getComputedStyle(toolbar)
      // The place the toolbar rests, on the screen, is where it sticks less its own margin.
      return Math.abs(document.querySelector('.toolbar-top').getBoundingClientRect().top - (parseFloat(style.top) - parseFloat(style.marginTop))) <= 1
    },
    null,
    { timeout: 8000 },
  )
  await quiet(page, 350)
}
export const titlesOf = (page) => page.evaluate(() => [...document.querySelectorAll('.grid[data-row] .card .ct')].map((e) => e.textContent))

// ---- running ------------------------------------------------------------------------------------

/** Whether `url` (a file's import.meta.url) is the file node was started with. */
export const isMain = (url) => !!process.argv[1] && fileURLToPath(url) === resolve(process.argv[1])

/**
 * Runs the tasks of the given modules. A module exports `tasks(env)`: a list of `{ name, label?, run }`, longest first.
 * The tasks are independent (each opens its own browser context), so a few run at once.
 */
export async function main(modules) {
  const args = process.argv.slice(2)
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
  const started = Date.now()
  const errors = []
  const served = option('--base') ? { url: option('--base'), close() {} } : await serveDist()
  const chrome = await chromium.launch()
  const safari = args.includes('--webkit') ? await webkit.launch() : null
  const traceDir = option('--trace')
  if (traceDir) {
    await mkdir(traceDir, { recursive: true })
    let serial = 0
    for (const browser of [chrome, safari].filter(Boolean)) {
      const create = browser.newContext.bind(browser)
      browser.newContext = async (...args) => {
        const ctx = await create(...args)
        const name = `context-${++serial}`
        await ctx.tracing.start({ snapshots: true, sources: true, screenshots: true })
        const close = ctx.close.bind(ctx)
        let closed = false
        ctx.close = async () => {
          if (closed) return
          closed = true
          for (const [i, page] of ctx.pages().entries()) {
            const scrolls = await page.evaluate(() => window.__scrolls ?? []).catch(() => [])
            await writeFile(join(traceDir, `${name}-${i}-scrolls.json`), JSON.stringify(scrolls))
          }
          await ctx.tracing.stop({ path: join(traceDir, `${name}.zip`) })
          await close()
        }
        running.getStore()?.contexts.push(ctx)
        await ctx.addInitScript(() => {
          window.__scrolls = []
          for (const key of ['scrollTo', 'scrollBy']) {
            const original = window[key].bind(window)
            window[key] = (...args) => {
              const before = scrollY
              original(...args)
              window.__scrolls.push({ key, args, before, after: scrollY, at: performance.now(), stack: new Error().stack })
            }
          }
        })
        return ctx
      }
    }
  }
  const env = { chrome, safari, base: served.url, errors, desktop, phone: phoneChromium, iphone: devices['iPhone 15 Pro'] }
  const all = modules.flatMap((m) => m.tasks(env)).filter(Boolean)
  const only = option('--only')?.split(',')
  const unknown = only?.filter((n) => !all.some((t) => t.name === n))
  if (unknown?.length) throw new Error(`No check is called ${unknown.join(', ')}. The names are: ${[...new Set(all.map((t) => t.name))].join(', ')}`)
  const queue = all.filter((t) => !only || only.includes(t.name))
  const durations = []

  const work = async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      const name = `${task.name}${task.label ? ` (${task.label})` : ''}`
      const store = { lines: [], contexts: [] }
      const at = Date.now()
      await running.run(store, () => task.run()).catch((e) => {
        failures.push(`${name} stopped: ${e.message}`)
        store.lines.push(`FAIL ${name} stopped: ${e.stack ?? e.message}`)
      })
      for (const ctx of store.contexts) await ctx.close()
      const seconds = (Date.now() - at) / 1000
      durations.push([name, seconds])
      console.log(`--- ${name}, ${seconds.toFixed(1)} s\n${store.lines.join('\n')}`)
    }
  }
  await Promise.all(Array.from({ length: Number(option('--jobs') ?? 4) }, work))
  await chrome.close()
  await safari?.close()
  served.close()

  const last = { lines: [] }
  running.run(last, () => check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join('; ')}` : ''}`))
  console.log(last.lines.join('\n'))
  const slowest = durations.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, s]) => `${n} ${s.toFixed(0)} s`)
  console.log(`Slowest: ${slowest.join(', ')}`)
  console.log(`${failures.length ? `${failures.length} failed` : 'All passed'}: ${checks} checks in ${Math.round((Date.now() - started) / 1000)} s`)
  process.exitCode = failures.length ? 1 : 0
}
