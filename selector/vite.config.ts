import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot, type Plugin } from 'vite'

const backend = process.env.RENPLAY_BACKEND ?? 'http://127.0.0.1:3999'
// What the server and the library both use: the adult levels, the recipe format, the answers.
const shared = fileURLToPath(new URL('../server/src/shared', import.meta.url))

// RENPLAY_BACKEND can point at a deployed renplay too.
const proxy = Object.fromEntries(['/api', '/g/', '/engine', '/renplay/runtime.js'].map((p) => [p, { target: backend, changeOrigin: true }]))

// The files PDF.js reads by name at run time, next to the build's own: the standard fonts (a PDF that does not carry
// its own) and the decoders for scanned pages. The folder is named by the version, since a kept copy never changes.
const pdfjs = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url))
const pdfjsVersion = (JSON.parse(readFileSync(`${pdfjs}package.json`, 'utf8')) as { version: string }).version
const pdfjsBase = `/assets/pdfjs-${pdfjsVersion}/`
const pdfjsFolders = ['standard_fonts', 'wasm']
const pdfjsFiles = (): Plugin => ({
  name: 'renplay-pdfjs-files',
  enforce: 'post',
  generateBundle() {
    for (const dir of pdfjsFolders)
      for (const name of readdirSync(`${pdfjs}${dir}`))
        if (!name.startsWith('LICENSE')) this.emitFile({ type: 'asset', fileName: `${pdfjsBase.slice(1)}${dir}/${name}`, source: readFileSync(`${pdfjs}${dir}/${name}`) })
  },
  // A kept game keeps the library's files from the build's list (lib/offline.ts): these are on it too.
  writeBundle({ dir }) {
    const list = `${dir}/asset-manifest.json`
    const assets = pdfjsFolders.flatMap((folder) => readdirSync(`${pdfjs}${folder}`).filter((name) => !name.startsWith('LICENSE')).map((name) => `${pdfjsBase.slice(1)}${folder}/${name}`))
    writeFileSync(list, JSON.stringify({ ...JSON.parse(readFileSync(list, 'utf8')), 'pdfjs-files': { assets } }, null, 2))
  },
  configureServer(server) {
    server.middlewares.use(pdfjsBase, (req, res, next) => {
      const [dir, name] = (req.url ?? '').split('?')[0]!.split('/').filter(Boolean)
      if (!dir || !name || !pdfjsFolders.includes(dir) || name.includes('..')) return next()
      res.end(readFileSync(`${pdfjs}${dir}/${decodeURIComponent(name)}`))
    })
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsFiles()],
  define: { __PDFJS_BASE__: JSON.stringify(pdfjsBase) },
  resolve: { alias: { '@shared': shared } },
  // The list of the build's files lets a kept game keep every page of the library (lib/offline.ts).
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 700, manifest: 'asset-manifest.json' },
  // The port the docs, the screenshots and the ui-check skill use.
  server: { port: 5199, proxy, fs: { allow: [searchForWorkspaceRoot(process.cwd()), shared] } },
  // The built library (npm run build, then vite preview), as the container serves it: offline play is checked there.
  preview: { proxy },
})
