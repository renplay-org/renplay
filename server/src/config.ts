import { join } from 'node:path'

function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : fallback
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] || '', 10)
  return Number.isFinite(v) ? v : fallback
}

export interface Config {
  port: number
  dataDir: string
  savesDir: string
  saveHistoryDir: string
  gamesDir: string
  /** Renplay-managed internals on the games volume: sdk, engines, work, trash. */
  internalDir: string
  /** Original game archives (zip/7z/rar). Drop folder and install source. */
  archivesDir: string
  workDir: string
  trashDir: string
  sdkDir: string
  enginesDir: string
  uploadsDir: string
  overlaysDir: string
  thumbnailsDir: string
  walkthroughsDir: string
  sdkVersion: string
  catalogUrls: string[]
  /** Optional URL that routes back to this pod through the scale-to-zero proxy. */
  keepaliveUrl: string
  keepaliveHost: string
  imageQuality: number
  imageConcurrency: number
  saveHistoryVersions: number
}

export function loadConfig(): Config {
  const dataDir = env('DATA_DIR', '/data')
  const gamesDir = env('GAMES_DIR', '/games')
  const internalDir = env('RENPLAY_DIR', join(gamesDir, '_renplay'))
  return {
    port: envInt('PORT', 3000),
    dataDir,
    savesDir: env('SAVES_DIR', join(dataDir, 'saves')),
    saveHistoryDir: env('SAVE_HISTORY_DIR', join(dataDir, 'save-history')),
    gamesDir,
    internalDir,
    archivesDir: env('ARCHIVES_DIR', join(gamesDir, '_archives')),
    workDir: join(internalDir, 'work'),
    trashDir: join(internalDir, 'trash'),
    sdkDir: join(internalDir, 'sdk'),
    enginesDir: join(internalDir, 'engines'),
    uploadsDir: join(internalDir, 'uploads'),
    overlaysDir: env('OVERLAYS_DIR', join(dataDir, 'overlays')),
    thumbnailsDir: join(dataDir, 'thumbnails'),
    walkthroughsDir: join(dataDir, 'walkthroughs'),
    sdkVersion: env('RENPY_SDK_VERSION', '8.5.3'),
    catalogUrls: env('RENPLAY_CATALOG_URLS', 'https://renplay-web.github.io/catalog/index.json')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    keepaliveUrl: env('RENPLAY_KEEPALIVE_URL', ''),
    keepaliveHost: env('RENPLAY_KEEPALIVE_HOST', ''),
    imageQuality: envInt('RENPLAY_IMAGE_QUALITY', 88),
    imageConcurrency: envInt('RENPLAY_IMAGE_CONCURRENCY', 0),
    saveHistoryVersions: envInt('RENPLAY_SAVE_HISTORY', 20),
  }
}
