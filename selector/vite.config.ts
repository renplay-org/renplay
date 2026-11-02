import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = process.env.RENPLAY_BACKEND ?? 'http://127.0.0.1:3999'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 700 },
  server: {
    proxy: {
      '/api': backend,
      '/g/': backend,
      '/engine': backend,
      '/renplay/runtime.js': backend,
    },
  },
})
