import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { RENPLAY_AUTH: 'off' },
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 15000,
    passWithNoTests: true,
  },
})
