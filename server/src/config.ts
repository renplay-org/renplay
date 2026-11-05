import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fallbackOf } from './envvars.js'

function env(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : fallback
}

function secret(name: string): string {
  if (process.env[name] && process.env[`${name}_FILE`]) throw new Error(`Set only ${name} or ${name}_FILE`)
  const file = process.env[`${name}_FILE`]
  return file ? readFileSync(file, 'utf-8').replace(/\r?\n$/, '') : process.env[name] ?? ''
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
  auth: '' | 'on' | 'off'
  authUser: number
  authLocal: boolean
  adminUsername: string
  adminPassword: string
  publicUrl: string
  trustedHops: number
  adultDefault: boolean
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
  const dataDir = env('DATA_DIR', fallbackOf('DATA_DIR'))
  const gamesDir = env('GAMES_DIR', fallbackOf('GAMES_DIR'))
  const internalDir = env('RENPLAY_DIR', join(gamesDir, '_renplay'))
  const auth = env('RENPLAY_AUTH', '')
  if (auth && auth !== 'on' && auth !== 'off') throw new Error('RENPLAY_AUTH must be on or off')
  return {
    auth: auth as '' | 'on' | 'off',
    authUser: envInt('RENPLAY_AUTH_USER', 1),
    authLocal: envBool('RENPLAY_AUTH_LOCAL', true),
    adminUsername: env('RENPLAY_ADMIN_USERNAME', ''),
    adminPassword: secret('RENPLAY_ADMIN_PASSWORD'),
    publicUrl: env('RENPLAY_PUBLIC_URL', ''),
    trustedHops: Math.max(0, envInt('RENPLAY_TRUSTED_HOPS', 1)),
    adultDefault: env('RENPLAY_ADULT_DEFAULT', 'block') === 'allow',
    port: envInt('PORT', fallbackOf('PORT')),
    dataDir,
    savesDir: env('SAVES_DIR', join(dataDir, 'saves')),
    saveHistoryDir: env('SAVE_HISTORY_DIR', join(dataDir, 'save-history')),
    coversDir: join(dataDir, 'covers'),
    walkthroughsDir: join(dataDir, 'walkthroughs'),
    overlaysDir: env('OVERLAYS_DIR', join(dataDir, 'overlays')),
    gamesDir,
    internalDir,
    archivesDir: env('ARCHIVES_DIR', join(gamesDir, '_archives')),
    deleteArchives: envBool('RENPLAY_DELETE_ARCHIVES', fallbackOf('RENPLAY_DELETE_ARCHIVES')),
    enginesDir: join(internalDir, 'engines'),
    workDir: join(internalDir, 'work'),
    purgeDir: join(internalDir, 'purge'),
    uploadsDir: join(internalDir, 'uploads'),
    enginesUrl: env('RENPLAY_ENGINES_URL', fallbackOf('RENPLAY_ENGINES_URL')),
    catalogUrls: env('RENPLAY_CATALOG_URLS', fallbackOf('RENPLAY_CATALOG_URLS'))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adultGames: adultGames(),
    defaultEngine: env('RENPLAY_ENGINE', fallbackOf('RENPLAY_ENGINE')),
    keepaliveUrl: env('RENPLAY_KEEPALIVE_URL', fallbackOf('RENPLAY_KEEPALIVE_URL')),
    keepaliveHost: env('RENPLAY_KEEPALIVE_HOST', fallbackOf('RENPLAY_KEEPALIVE_HOST')),
    imageQuality: envInt('RENPLAY_IMAGE_QUALITY', fallbackOf('RENPLAY_IMAGE_QUALITY')),
    imageConcurrency: envInt('RENPLAY_IMAGE_CONCURRENCY', fallbackOf('RENPLAY_IMAGE_CONCURRENCY')),
    saveHistoryVersions: envInt('RENPLAY_SAVE_HISTORY', fallbackOf('RENPLAY_SAVE_HISTORY')),
  }
}
