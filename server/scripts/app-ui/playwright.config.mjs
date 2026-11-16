import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  testDir: './specs',
  workers: 1,
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
    trace: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    // The library's own checks (specs/chromium/) run on a desktop and on a phone's size in Chromium, which has what they read:
    // layout shift, a finger drawn with touch events, the clock. The phone is what an iPhone is to the page.
    { name: 'chromium-phone', testMatch: /specs\/chromium\//, use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'webkit-portrait', testIgnore: /specs\/chromium\//, use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'webkit-landscape', testIgnore: /static-demo\.spec|specs\/chromium\//, use: { browserName: 'webkit', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    // The static demo's service worker has its own WebKit fixes: it is also checked at desktop size.
    { name: 'webkit-desktop', testMatch: /static-demo\.spec/, use: { browserName: 'webkit', viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'node scripts/app-ui/serve.mjs',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
  },
})
