// The report, schema 1: validated field by field, and turned into what the collector keeps. Unknown
// fields are ignored, missing numbers count as zero, and anything of the wrong type or size is refused.
import { cleanMessage } from './clean'

export const MAX_BODY = 64 * 1024
const MAX_CATALOG = 500
const MAX_ERRORS = 50
const MAX_COUNT = 10_000_000

const ID = /^[a-z0-9-]{1,80}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,20})?$/
// A release name as the catalog writes it ("1.5.5", "Season 1", "Patreon(0.77)"). Anything else is dropped from the
// entry, never the reason a report is refused: the rest of the report still counts.
const RELEASE = /^[0-9A-Za-z][0-9A-Za-z ._+()[\]-]{0,39}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

const ARCH = ['arm64', 'x64']
const INSTALL = ['image', 'chart', 'compose', 'source', 'demo']
const AUTH = ['off', 'password', 'oidc', 'ldap', 'mixed']
const ADULT = ['off', 'blurred', 'shown']
const GAMES_GB = ['<1', '1-10', '10-100', '100-1000', '>1000']
const DATA_GB = ['<1', '1-10', '10-100', '>100']
const ERROR_KINDS = ['install', 'runtime', 'sync']

// The counts that are summed into usage_days, by section. Other keys are ignored.
const SCALE = ['users', 'devices', 'games', 'renpyGames', 'htmlGames', 'catalogGames', 'localGames', 'saves', 'mods']
const PLAY = ['sessions', 'minutes', 'homeScreen', 'offline', 'controller', 'fullscreen']
const DEVICES = ['phone', 'tablet', 'desktop']
const BROWSERS = ['webkit', 'blink', 'gecko']
const FPS = ['under30', '30to50', '50up']
const FEATURES = ['walkthroughs', 'syncCodes', 'saveImports', 'artChoices', 'keptOffline', 'modBuilds', 'catalogRefresh', 'adultLevelsChanged']

export interface CatalogEntry {
  game: string
  release: string
  installed: number
  installsOk: number
  installsFailed: number
  installSeconds: number
  playsSessions: number
  playsMinutes: number
  errors: number
}

export interface ErrorEntry {
  game: string
  kind: string
  message: string
  count: number
}

export interface Report {
  instance: string
  version: string
  day: string
  setup: { arch: string | null; install: string | null; auth: string | null; adultInstall: string | null; gamesGB: string | null; dataGB: string | null }
  usage: Record<string, number>
  catalog: CatalogEntry[]
  errors: ErrorEntry[]
}

export type Checked = { ok: true; report: Report } | { ok: false; reason: string }

class Bad extends Error {}
const bad = (reason: string): never => {
  throw new Bad(reason)
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function obj(v: unknown, name: string): Obj {
  if (v === undefined || v === null) return {}
  return isObj(v) ? v : bad(`${name} must be an object`)
}

function num(v: unknown, name: string, max = MAX_COUNT, whole = true): number {
  if (v === undefined || v === null) return 0
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max || (whole && !Number.isInteger(v))) return bad(`${name} must be a number from 0 to ${max}`)
  return v
}

function oneOf(v: unknown, name: string, allowed: string[]): string | null {
  if (v === undefined || v === null) return null
  return typeof v === 'string' && allowed.includes(v) ? v : bad(`${name} is not one of ${allowed.join(', ')}`)
}

function text(v: unknown, name: string, pattern: RegExp): string {
  return typeof v === 'string' && pattern.test(v) ? v : bad(`${name} is missing or malformed`)
}

function counts(section: Obj, prefix: string, keys: string[], usage: Record<string, number>) {
  for (const key of keys) {
    const n = num(section[key], `${prefix}.${key}`)
    if (n) usage[`${prefix}.${key}`] = n
  }
}

/** Whether `day` is a real date not more than three days from today (UTC), as YYYY-MM-DD. */
function dayIsNear(day: string, today: string): boolean {
  const t = Date.parse(`${day}T00:00:00Z`)
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day) return false
  return Math.abs(t - Date.parse(`${today}T00:00:00Z`)) <= 3 * 86_400_000
}

function validate(body: unknown, today: string): Report {
  if (!isObj(body)) return bad('the report must be an object')
  if (body.schema !== 1) bad('schema must be 1')
  const day = text(body.day, 'day', DAY)
  if (!dayIsNear(day, today)) bad('day is not a recent date')

  const setup = obj(body.setup, 'setup')
  num(setup.uptimeDays, 'setup.uptimeDays')
  const usage: Record<string, number> = {}
  counts(obj(body.scale, 'scale'), 'scale', SCALE, usage)
  const play = obj(body.play, 'play')
  counts(play, 'play', PLAY, usage)
  counts(obj(play.devices, 'play.devices'), 'play.devices', DEVICES, usage)
  counts(obj(play.browsers, 'play.browsers'), 'play.browsers', BROWSERS, usage)
  counts(obj(play.fps, 'play.fps'), 'play.fps', FPS, usage)
  counts(obj(body.features, 'features'), 'features', FEATURES, usage)
  const load = obj(play.loadSeconds, 'play.loadSeconds')
  const p50 = num(load.p50, 'play.loadSeconds.p50', 86_400, false)
  const p90 = num(load.p90, 'play.loadSeconds.p90', 86_400, false)
  if (p50 > 0) {
    usage['play.loadSeconds.p50'] = p50
    usage['play.loadSeconds.p90'] = p90
    usage['play.loadSeconds.count'] = 1
  }

  const catalogIn = body.catalog ?? []
  if (!Array.isArray(catalogIn)) bad('catalog must be a list')
  if ((catalogIn as unknown[]).length > MAX_CATALOG) bad(`catalog has more than ${MAX_CATALOG} entries`)
  const catalog = (catalogIn as unknown[]).map((raw, i): CatalogEntry => {
    const e = obj(raw, `catalog[${i}]`)
    const installs = obj(e.installs, `catalog[${i}].installs`)
    const plays = obj(e.plays, `catalog[${i}].plays`)
    const name = `catalog[${i}]`
    return {
      game: text(e.game, `${name}.game`, ID),
      release: typeof e.release === 'string' && RELEASE.test(e.release) ? e.release : '',
      installed: num(e.installed, `${name}.installed`),
      installsOk: num(installs.ok, `${name}.installs.ok`),
      installsFailed: num(installs.failed, `${name}.installs.failed`),
      installSeconds: num(installs.seconds, `${name}.installs.seconds`, 31_536_000, false),
      playsSessions: num(plays.sessions, `${name}.plays.sessions`),
      playsMinutes: num(plays.minutes, `${name}.plays.minutes`, MAX_COUNT, false),
      errors: num(e.errors, `${name}.errors`),
    }
  })

  const errorsIn = body.errors ?? []
  if (!Array.isArray(errorsIn)) bad('errors must be a list')
  if ((errorsIn as unknown[]).length > MAX_ERRORS) bad(`errors has more than ${MAX_ERRORS} entries`)
  const errors: ErrorEntry[] = []
  ;(errorsIn as unknown[]).forEach((raw, i) => {
    const e = obj(raw, `errors[${i}]`)
    const kind = oneOf(e.kind, `errors[${i}].kind`, ERROR_KINDS)
    if (!kind) bad(`errors[${i}].kind is missing`)
    if (typeof e.message !== 'string') bad(`errors[${i}].message must be text`)
    const game = e.game === undefined || e.game === null ? '' : text(e.game, `errors[${i}].game`, ID)
    const message = cleanMessage(e.message as string)
    // An error with nothing left to say is not kept.
    if (!message) return
    errors.push({ game, kind: kind as string, message, count: Math.max(1, num(e.count, `errors[${i}].count`)) })
  })

  return {
    instance: text(body.instance, 'instance', UUID),
    version: text(body.version, 'version', VERSION),
    day,
    setup: {
      arch: oneOf(setup.arch, 'setup.arch', ARCH),
      install: oneOf(setup.install, 'setup.install', INSTALL),
      auth: oneOf(setup.auth, 'setup.auth', AUTH),
      adultInstall: oneOf(setup.adultInstall, 'setup.adultInstall', ADULT),
      gamesGB: oneOf(setup.gamesGB, 'setup.gamesGB', GAMES_GB),
      dataGB: oneOf(setup.dataGB, 'setup.dataGB', DATA_GB),
    },
    usage,
    catalog,
    errors,
  }
}

/** Checks a parsed body. `today` is the collector's own UTC date, YYYY-MM-DD. */
export function check(body: unknown, today: string): Checked {
  try {
    return { ok: true, report: validate(body, today) }
  } catch (e) {
    if (e instanceof Bad) return { ok: false, reason: e.message }
    throw e
  }
}
