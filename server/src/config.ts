import { join } from 'node:path'
import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { parseAdultGroups } from './content/levels.js'
import { parseAdultLevel, type AdultLevel } from './shared/levels.js'
import { SAVE_FILE_BYTES } from './saves/savefile.js'
import { fallbackOf } from './envvars.js'

/*
 * Every variable is documented, with its default, in envvars.ts. These read one, falling back to
 * that default, so a default is written once. A default worked out from other variables is '' in
 * the table, and loadConfig works it out.
 */
function text(name: string): string {
  const v = process.env[name]
  return v && v.trim() ? v.trim() : String(fallbackOf(name))
}

function secret(name: string): string {
  if (process.env[name] && process.env[`${name}_FILE`]) throw new Error(`Set only ${name} or ${name}_FILE`)
  const file = process.env[`${name}_FILE`]
  return file ? readFileSync(file, 'utf-8').replace(/\r?\n$/, '') : process.env[name] ?? ''
}

function int(name: string): number {
  const v = parseInt(process.env[name] || '', 10)
  return Number.isFinite(v) ? v : fallbackOf<number>(name)
}

function bool(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase()
  if (!v) return fallbackOf<boolean>(name)
  return !['0', 'false', 'no', 'off'].includes(v)
}

/** Anything but a level is a mistake; the safe-for-work side is the safe reading of it. */
function adultGames(): '' | AdultLevel {
  const raw = process.env['RENPLAY_ADULT_GAMES']?.trim()
  if (!raw) return ''
  const level = parseAdultLevel(raw, true)
  if (level) return level
  console.warn(`config: RENPLAY_ADULT_GAMES=${raw} is not off, blurred or shown. Adult games are off.`)
  return 'off'
}

function adultDefault(): AdultLevel {
  const raw = process.env['RENPLAY_ADULT_DEFAULT']?.trim()
  if (!raw) return 'off'
  const level = parseAdultLevel(raw, true)
  if (level) return level
  console.warn(`config: RENPLAY_ADULT_DEFAULT=${raw} is not off, blurred or shown. New people start with adult games off.`)
  return 'off'
}

/** group=level lists from the sign-in providers, or the single group that means shown. */
function adultGroups(raw: string, variable: string, alias: string, aliasVariable: string): { map: Record<string, AdultLevel>; variable: string } | null {
  if (raw) {
    // A mapping with no valid entry still means the groups decide: nobody matches, so everyone is
    // at Off until it is fixed. Reading a typo as no mapping would leave hand settings in force.
    const map = parseAdultGroups(raw, variable) ?? {}
    if (!Object.keys(map).length) console.error(`config: ${variable} has no valid group=off, =blurred or =shown entry. Everyone who signs in through it gets adult games off.`)
    return { map, variable }
  }
  if (alias) {
    console.warn(`config: ${aliasVariable} is an older way to set ${variable}. It means ${alias}=shown and everyone else off.`)
    return { map: { [alias]: 'shown' }, variable: aliasVariable }
  }
  return null
}

/** Only select an existing writable downloads mount. Never create it or move files. */
export function downloadsDirectory(gamesDir: string, downloads = '/downloads'): string {
  try {
    if (statSync(downloads).isDirectory()) {
      accessSync(downloads, constants.W_OK)
      return downloads
    }
  } catch { /* No usable optional mount: the folder inside the games folder. */ }
  return join(gamesDir, '_archives')
}

let warnedDeleteArchives = false

/** Limits for a shared account on a public server (the demo): one file, and all files with their history. */
export interface SaveLimits {
  file: number
  total: number
  files: number
}

export interface Config {
  auth: '' | 'on' | 'off'
  authUser: number
  authLocal: boolean
  oidcIssuer: string
  oidcClientId: string
  oidcClientSecret: string
  oidcName: string
  oidcAutoCreate: boolean
  oidcAdminGroup: string
  /** group=level ceilings matched on the groups claim exactly; null when no mapping is configured. */
  oidcAdultGroups: Record<string, AdultLevel> | null
  /** Which variable oidcAdultGroups came from: RENPLAY_OIDC_ADULT_GROUPS or RENPLAY_OIDC_ADULT_GROUP. */
  oidcAdultGroupsVariable: string
  admins: string[]
  ldapUrl: string
  ldapBindDn: string
  ldapBindPassword: string
  ldapBaseDn: string
  ldapUserFilter: string
  ldapUsernameAttribute: string
  ldapNameAttribute: string
  ldapEmailAttribute: string
  ldapPhotoAttribute: string
  ldapAdminFilter: string
  ldapAdultFilter: string
  /** group=level ceilings from RENPLAY_LDAP_ADULT_GROUPS, matched on memberOf cn, case-insensitive. */
  ldapAdultGroups: Record<string, AdultLevel> | null
  ldapStartTls: boolean
  ldapCaFile: string
  adminUsername: string
  adminPassword: string
  publicUrl: string
  trustedHops: number
  /** Ceiling and starting choice for new people. */
  adultDefault: AdultLevel
  port: number
  dataDir: string
  walkthroughsDir: string
  overlaysDir: string
  /** Installed games: <gamesDir>/<id>/<build>/. */
  gamesDir: string
  /** renplay internals on the games volume: engines, work, purge, uploads. */
  internalDir: string
  /** Original game archives (zip/7z/rar): drop folder and reinstall source. */
  archivesDir: string
  /** Keep downloads unless an admin opts into upload cleanup. */
  keepDownloads: boolean
  keepDownloadsLocked: boolean
  enginesDir: string
  workDir: string
  purgeDir: string
  uploadsDir: string
  enginesUrl: string
  catalogUrls: string[]
  /** RENPLAY_ADULT_GAMES: a level fixes the installation; empty leaves it to the stored setting (content/mode.ts). */
  adultGames: '' | AdultLevel
  /** A public demo: a shared guest, no uploads or account changes, a stop after 4 hours (RENPLAY_DEMO). */
  demo: boolean
  /** How much one person may store in saves: a file, and all files with their history. Limited in a demo. */
  saveLimits: SaveLimits
  /** Pin every build to this engine version instead of the latest 8.x. */
  defaultEngine: string
  /** Optional URL that routes back to this pod through the scale-to-zero proxy. */
  keepaliveUrl: string
  keepaliveHost: string
  imageQuality: number
  imageConcurrency: number
  saveHistoryVersions: number
  /** Where the daily save backup goes, or null when backups are off. */
  backupDir: string | null
  backupKeep: number
  /** Your recipes: a folder of recipe files read as one more catalog. */
  recipesDir: string
  /** Ren'Py's sync server, for Sync codes. */
  syncServer: string
  /** RENPLAY_TELEMETRY: 'on' or 'off' wins over the switch in Settings; empty leaves it to the switch (telemetry/telemetry.ts). */
  telemetry: '' | 'on' | 'off'
  telemetryUrl: string
  /** How this Renplay was installed, as the image and the chart say (RENPLAY_INSTALL). */
  install: string
}

export function loadConfig(): Config {
  const dataDir = text('DATA_DIR')
  const gamesDir = text('GAMES_DIR')
  const internalDir = text('RENPLAY_DIR') || join(gamesDir, '_renplay')
  const deleteArchives = !!process.env['RENPLAY_DELETE_ARCHIVES']?.trim()
  const keepSet = !!process.env['RENPLAY_KEEP_DOWNLOADS']?.trim()
  const keepDownloadsLocked = keepSet || deleteArchives
  if (deleteArchives && !warnedDeleteArchives) {
    console.warn('config: RENPLAY_DELETE_ARCHIVES is deprecated. Use RENPLAY_KEEP_DOWNLOADS with the opposite value. RENPLAY_KEEP_DOWNLOADS takes precedence.')
    warnedDeleteArchives = true
  }
  const keepDownloads = deleteArchives && !keepSet ? !bool('RENPLAY_DELETE_ARCHIVES') : bool('RENPLAY_KEEP_DOWNLOADS')
  const auth = text('RENPLAY_AUTH')
  if (auth && auth !== 'on' && auth !== 'off') throw new Error('RENPLAY_AUTH must be on or off')
  if (process.env['RENPLAY_LDAP_ADULT_GROUPS']?.trim() && process.env['RENPLAY_LDAP_ADULT_FILTER']?.trim())
    console.warn('config: RENPLAY_LDAP_ADULT_GROUPS is set, so the RENPLAY_LDAP_ADULT_FILTER alias is ignored.')
  const oidcGroups = adultGroups(text('RENPLAY_OIDC_ADULT_GROUPS'), 'RENPLAY_OIDC_ADULT_GROUPS', text('RENPLAY_OIDC_ADULT_GROUP'), 'RENPLAY_OIDC_ADULT_GROUP')
  const ldapGroups = adultGroups(text('RENPLAY_LDAP_ADULT_GROUPS'), 'RENPLAY_LDAP_ADULT_GROUPS', '', '')
  return {
    auth: auth as '' | 'on' | 'off',
    authUser: int('RENPLAY_AUTH_USER'),
    authLocal: bool('RENPLAY_AUTH_LOCAL'),
    oidcIssuer: text('RENPLAY_OIDC_ISSUER'),
    oidcClientId: text('RENPLAY_OIDC_CLIENT_ID'),
    oidcClientSecret: secret('RENPLAY_OIDC_CLIENT_SECRET'),
    oidcName: text('RENPLAY_OIDC_NAME'),
    oidcAutoCreate: bool('RENPLAY_OIDC_AUTO_CREATE'),
    oidcAdminGroup: text('RENPLAY_OIDC_ADMIN_GROUP'),
    oidcAdultGroups: oidcGroups?.map ?? null,
    oidcAdultGroupsVariable: oidcGroups?.variable ?? '',
    admins: text('RENPLAY_ADMINS').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    ldapUrl: text('RENPLAY_LDAP_URL'),
    ldapBindDn: text('RENPLAY_LDAP_BIND_DN'),
    ldapBindPassword: secret('RENPLAY_LDAP_BIND_PASSWORD'),
    ldapBaseDn: text('RENPLAY_LDAP_BASE_DN'),
    ldapUserFilter: text('RENPLAY_LDAP_USER_FILTER'),
    ldapUsernameAttribute: text('RENPLAY_LDAP_USERNAME_ATTRIBUTE'),
    ldapNameAttribute: text('RENPLAY_LDAP_NAME_ATTRIBUTE'),
    ldapEmailAttribute: text('RENPLAY_LDAP_EMAIL_ATTRIBUTE'),
    ldapPhotoAttribute: text('RENPLAY_LDAP_PHOTO_ATTRIBUTE'),
    ldapAdminFilter: text('RENPLAY_LDAP_ADMIN_FILTER'),
    ldapAdultFilter: text('RENPLAY_LDAP_ADULT_FILTER'),
    ldapAdultGroups: ldapGroups?.map ?? null,
    ldapStartTls: bool('RENPLAY_LDAP_STARTTLS'),
    ldapCaFile: text('RENPLAY_LDAP_CA_FILE'),
    adminUsername: text('RENPLAY_ADMIN_USERNAME'),
    adminPassword: secret('RENPLAY_ADMIN_PASSWORD'),
    publicUrl: text('RENPLAY_PUBLIC_URL'),
    trustedHops: Math.max(0, int('RENPLAY_TRUSTED_HOPS')),
    adultDefault: adultDefault(),
    port: int('PORT'),
    dataDir,
    walkthroughsDir: join(dataDir, 'walkthroughs'),
    overlaysDir: text('OVERLAYS_DIR') || join(dataDir, 'overlays'),
    gamesDir,
    internalDir,
    archivesDir: text('ARCHIVES_DIR') || downloadsDirectory(gamesDir),
    keepDownloads,
    keepDownloadsLocked,
    enginesDir: join(internalDir, 'engines'),
    workDir: join(internalDir, 'work'),
    purgeDir: join(internalDir, 'purge'),
    uploadsDir: join(internalDir, 'uploads'),
    enginesUrl: text('RENPLAY_ENGINES_URL'),
    catalogUrls: text('RENPLAY_CATALOG_URLS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adultGames: adultGames(),
    demo: bool('RENPLAY_DEMO'),
    saveLimits: bool('RENPLAY_DEMO') ? { file: 2 << 20, total: 32 << 20, files: 1000 } : { file: SAVE_FILE_BYTES, total: Infinity, files: Infinity },
    defaultEngine: text('RENPLAY_ENGINE'),
    keepaliveUrl: text('RENPLAY_KEEPALIVE_URL'),
    keepaliveHost: text('RENPLAY_KEEPALIVE_HOST'),
    imageQuality: int('RENPLAY_IMAGE_QUALITY'),
    imageConcurrency: int('RENPLAY_IMAGE_CONCURRENCY'),
    saveHistoryVersions: int('RENPLAY_SAVE_HISTORY'),
    backupDir: (() => {
      const raw = text('RENPLAY_BACKUP_DIR')
      if (raw.toLowerCase() === 'off') return null
      return raw || join(dataDir, 'backups', 'saves')
    })(),
    backupKeep: Math.max(1, int('RENPLAY_BACKUP_KEEP')),
    recipesDir: text('RENPLAY_RECIPES_DIR') || join(dataDir, 'recipes'),
    syncServer: text('RENPLAY_SYNC_SERVER').replace(/\/+$/, ''),
    telemetry: process.env['RENPLAY_TELEMETRY']?.trim() ? (bool('RENPLAY_TELEMETRY') ? 'on' : 'off') : '',
    telemetryUrl: text('RENPLAY_TELEMETRY_URL'),
    install: text('RENPLAY_INSTALL'),
  }
}
