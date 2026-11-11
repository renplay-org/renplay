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
    { name: 'webkit-portrait', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'webkit-landscape', use: { browserName: 'webkit', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'node scripts/app-ui/serve.mjs',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
  },
})
