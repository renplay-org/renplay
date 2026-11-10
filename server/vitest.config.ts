import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// What the server and the library share. The tests check parts of the library too.
const shared = fileURLToPath(new URL('./src/shared', import.meta.url))

export default defineConfig({
  resolve: { alias: { '@shared': shared } },
  test: {
    // Tests never send the report; the ones about it turn it on against a stub.
    env: { RENPLAY_AUTH: 'off', RENPLAY_TELEMETRY: 'off' },
    include: ['src/**/__tests__/**/*.test.ts'],
    testTimeout: 15000,
    passWithNoTests: true,
  },
})
