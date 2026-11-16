import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const CI = !!process.env.CI
const webkitWorkers = CI ? 2 : 3

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.mjs',
  // The container has four CPUs. A Chromium test waits more than it works, so five of them side by side fit. A WebKit test keeps
  // three cores busy (it draws in software), so each WebKit project takes three workers at most. Every test has its own page, so
  // the tests of one file run side by side too. CI's four vCPUs are two cores with two threads each, about 2.6 of this laptop's
  // container CPUs: its workers are fewer, so that a test is not starved of the frames it waits for.
  workers: CI ? 4 : 5,
  fullyParallel: true,
  retries: 1,
  forbidOnly: !!process.env.CI,
  timeout: 20000,
  expect: { timeout: 8000 },
  outputDir: '../../../ui-test-results/traces',
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['json', { outputFile: fileURLToPath(new URL('../../../ui-test-results/report.json', import.meta.url)) }],
    ['./summary-reporter.mjs'],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4179',
    serviceWorkers: 'block',
    trace: { mode: 'retain-on-failure', screenshots: false },
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  // WebKit goes first: it draws in software and takes twice as long to do the same, so its tests get twice the time, and the
  // Chromium tests that wait more than they work fill the cores it leaves when it is done.
  projects: [
    { name: 'webkit-portrait', workers: webkitWorkers, timeout: 40000, testIgnore: /specs\/chromium\//, use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'webkit-landscape', workers: webkitWorkers, timeout: 40000, testIgnore: /static-demo\.spec|specs\/chromium\//, use: { browserName: 'webkit', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    // The static demo's service worker has its own WebKit fixes: it is also checked at desktop size.
    { name: 'webkit-desktop', workers: webkitWorkers, timeout: 40000, testMatch: /static-demo\.spec/, use: { browserName: 'webkit', viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    // The library's own checks (specs/chromium/) run on a desktop and on a phone's size in Chromium, which has what they read:
    // layout shift, a finger drawn with touch events, the clock. The phone is what an iPhone is to the page.
    { name: 'chromium-phone', testMatch: /specs\/chromium\//, use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'node scripts/app-ui/serve.mjs',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
  },
})
