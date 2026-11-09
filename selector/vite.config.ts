import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

const backend = process.env.RENPLAY_BACKEND ?? 'http://127.0.0.1:3999'
// What the server and the library both use: the adult levels, the recipe format, the answers.
const shared = fileURLToPath(new URL('../server/src/shared', import.meta.url))

// RENPLAY_BACKEND can point at a deployed renplay too.
const proxy = Object.fromEntries(['/api', '/g/', '/engine', '/renplay/runtime.js'].map((p) => [p, { target: backend, changeOrigin: true }]))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': shared } },
  // The list of the build's files lets a kept game keep every page of the library (lib/offline.ts).
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 700, manifest: 'asset-manifest.json' },
  // The port the docs, the screenshots and the ui-check skill use.
  server: { port: 5199, proxy, fs: { allow: [searchForWorkspaceRoot(process.cwd()), shared] } },
  // The built library (npm run build, then vite preview), as the container serves it: offline play is checked there.
  preview: { proxy },
})
