import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = process.env.RENPLAY_BACKEND ?? 'http://127.0.0.1:3999'

// RENPLAY_BACKEND can point at a deployed renplay too.
const proxy = Object.fromEntries(['/api', '/g/', '/engine', '/renplay/runtime.js'].map((p) => [p, { target: backend, changeOrigin: true }]))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 700 },
  // The port the docs, the screenshots and the ui-check skill use.
  server: { port: 5199, proxy },
  // The built library (npm run build, then vite preview), as the container serves it: offline play is checked there.
  preview: { proxy },
})
