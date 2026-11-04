import { join } from 'node:path'

function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : fallback
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] || '', 10)
  return Number.isFinite(v) ? v : fallback
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  if (!v) return fallback
  return !['0', 'false', 'no', 'off'].includes(v)
}

/** Anything but allow or block is a mistake; the safe-for-work side is the safe reading of it. */
function adultGames(): '' | 'allow' | 'block' {
  const v = process.env['RENPLAY_ADULT_GAMES']?.trim().toLowerCase()
  if (!v) return ''
  if (v === 'allow' || v === 'block') return v
  console.warn(`RENPLAY_ADULT_GAMES=${v} is not "allow" or "block"; blocking adult games`)
  return 'block'
}

export interface Config {
  port: number
  dataDir: string
  savesDir: string
  saveHistoryDir: string
  coversDir: string
  walkthroughsDir: string
  overlaysDir: string
  /** Installed games: <gamesDir>/<id>/<build>/. */
  gamesDir: string
  /** renplay internals on the games volume: engines, work, purge, uploads. */
  internalDir: string
  /** Original game archives (zip/7z/rar): drop folder and reinstall source. */
  archivesDir: string
  /** Delete an archive once it installed. Off keeps it for reinstalls. */
  deleteArchives: boolean
  enginesDir: string
  workDir: string
  purgeDir: string
  uploadsDir: string
  enginesUrl: string
  catalogUrls: string[]
  /** RENPLAY_ADULT_GAMES: allow or block locks the choice; empty leaves it to the admin (content.ts). */
  adultGames: '' | 'allow' | 'block'
  /** Pin every build to this engine version instead of the latest 8.x. */
  defaultEngine: string
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
    coversDir: join(dataDir, 'covers'),
    walkthroughsDir: join(dataDir, 'walkthroughs'),
    overlaysDir: env('OVERLAYS_DIR', join(dataDir, 'overlays')),
    gamesDir,
    internalDir,
    archivesDir: env('ARCHIVES_DIR', join(gamesDir, '_archives')),
    deleteArchives: envBool('RENPLAY_DELETE_ARCHIVES', true),
    enginesDir: join(internalDir, 'engines'),
    workDir: join(internalDir, 'work'),
    purgeDir: join(internalDir, 'purge'),
    uploadsDir: join(internalDir, 'uploads'),
    enginesUrl: env('RENPLAY_ENGINES_URL', 'https://engines.renplay.org/index.json'),
    catalogUrls: env('RENPLAY_CATALOG_URLS', 'https://catalog.renplay.org/index.v3.json')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adultGames: adultGames(),
    defaultEngine: env('RENPLAY_ENGINE', ''),
    keepaliveUrl: env('RENPLAY_KEEPALIVE_URL', ''),
    keepaliveHost: env('RENPLAY_KEEPALIVE_HOST', ''),
    imageQuality: envInt('RENPLAY_IMAGE_QUALITY', 88),
    imageConcurrency: envInt('RENPLAY_IMAGE_CONCURRENCY', 0),
    saveHistoryVersions: envInt('RENPLAY_SAVE_HISTORY', 20),
  }
}
