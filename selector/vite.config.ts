import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = process.env.RENPLAY_BACKEND ?? 'http://127.0.0.1:3999'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 700 },
  server: {
    // RENPLAY_BACKEND can point at a deployed renplay too.
    proxy: Object.fromEntries(['/api', '/g/', '/engine', '/renplay/runtime.js'].map((p) => [p, { target: backend, changeOrigin: true }])),
  },
})
