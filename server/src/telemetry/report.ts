import { randomUUID } from 'node:crypto'
import type { Accounts } from '../accounts/accounts.js'
import type { Catalog } from '../catalog/catalog.js'
import type { Config } from '../config.js'
import type { ContentMode } from '../content/mode.js'
import { parseJson, type Db, type GameSource } from '../db.js'
import type { SaveStores } from '../saves/stores.js'
import type { AdultLevel } from '../shared/levels.js'
import { installedRelease } from '../shared/recipe.js'
import { dirSize } from '../util/fsx.js'
import { FPS_BUCKETS, type DayCounts } from './counters.js'

/** Everything the report is made from. */
export interface ReportSources {
  cfg: Config
  db: Db
  catalog: Catalog
  content: ContentMode
  accounts: Accounts
  saveStores: SaveStores
  version: string
}

export interface CatalogEntry {
  game: string
  release: string
  installed: number
  installs: { ok: number; failed: number; seconds: number; engine: string }
  plays: { sessions: number; minutes: number }
  errors: number
}

/** The report, schema 1 (the contract is in the Telemetry page of the docs). */
export interface Report {
  schema: 1
  instance: string
  version: string
  day: string
  setup: {
    arch: 'arm64' | 'x64'
    install: 'image' | 'chart' | 'compose' | 'source' | 'demo'
    auth: 'off' | 'password' | 'oidc' | 'ldap' | 'mixed'
    adultInstall: AdultLevel
    uptimeDays: number
    gamesGB: string
    dataGB: string
  }
  scale: { users: number; devices: number; games: number; renpyGames: number; htmlGames: number; catalogGames: number; localGames: number; saves: number; mods: number }
  play: {
    sessions: number
    minutes: number
    devices: Record<string, number>
    browsers: Record<string, number>
    homeScreen: number
    offline: number
    controller: number
    fullscreen: number
    loadSeconds: { p50: number; p90: number }
    fps: Record<string, number>
  }
  features: Record<string, number>
  catalog: CatalogEntry[]
  errors: Array<{ game: string; kind: string; message: string; count: number }>
}

const KEY = 'telemetry_instance'
const GB = 1e9
/** The collector takes at most this many. */
const MAX_CATALOG = 500
const MAX_ERRORS = 50
/** The collector takes bodies under 64 KB. */
const MAX_BYTES = 60_000

/** The id of this installation, made once. It only lets the collector count installations. */
function instanceId(db: Db): string {
  let id = db.getSetting<string>(KEY, '')
  if (!id) {
    id = randomUUID()
    db.setSetting(KEY, id)
  }
  return id
}

function bucket(bytes: number, edges: number[], names: string[]): string {
  const gb = bytes / GB
  const i = edges.findIndex((e) => gb < e)
  return names[i === -1 ? names.length - 1 : i]!
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! * 10) / 10
}

function authKind(cfg: Config, accounts: Accounts): Report['setup']['auth'] {
  if (!accounts.enabled) return 'off'
  const methods = [cfg.authLocal && 'password', cfg.oidcIssuer && 'oidc', cfg.ldapUrl && 'ldap'].filter(Boolean) as Array<'password' | 'oidc' | 'ldap'>
  return methods.length === 1 ? methods[0]! : 'mixed'
}

function installKind(cfg: Config): Report['setup']['install'] {
  if (cfg.demo) return 'demo'
  return cfg.install === 'image' || cfg.install === 'chart' || cfg.install === 'compose' ? cfg.install : 'source'
}

const number = (db: Db, sql: string, ...args: number[]) => Number((db.raw.prepare(sql).get(...args) as { n: number }).n)

/**
 * The report for one UTC day. Games appear only by the id of their recipe in the official catalog;
 * a game without one is only counted. Nothing here reads a title, a name, a path or a save.
 */
export async function buildReport(src: ReportSources, day: string, counts: DayCounts): Promise<Report> {
  const { cfg, db, catalog } = src
  const games = db.allGames()
  const official = (recipeId: string) => (recipeId ? catalog.officialRecipe(recipeId) : null)
  const linked = games.filter((g) => official(g.recipe_id))

  // The day's plays come from the play history, which exists with or without the report.
  const from = Date.parse(`${day}T00:00:00Z`)
  const sessions = db.raw.prepare('SELECT game, COUNT(*) sessions, COALESCE(SUM(seconds), 0) seconds FROM play_sessions WHERE started_at >= ? AND started_at < ? GROUP BY game').all(from, from + 86_400_000) as Array<{ game: string; sessions: number; seconds: number }>
  const plays = new Map<string, { sessions: number; seconds: number }>()
  for (const s of sessions) {
    const recipe = official(db.getGame(s.game)?.recipe_id ?? '')?.id
    if (!recipe) continue
    const p = plays.get(recipe) ?? { sessions: 0, seconds: 0 }
    p.sessions += s.sessions
    p.seconds += s.seconds
    plays.set(recipe, p)
  }

  const errorRows = Object.entries(counts.errors).map(([key, count]) => {
    const [game, kind, message] = parseJson<[string, string, string]>(key, ['', '', ''])
    return { game, kind, message, count }
  }).filter((e) => official(e.game))
  const entries = new Map<string, CatalogEntry>()
  const entry = (game: string): CatalogEntry => {
    let e = entries.get(game)
    if (!e) entries.set(game, (e = { game, release: '', installed: 0, installs: { ok: 0, failed: 0, seconds: 0, engine: '' }, plays: { sessions: 0, minutes: 0 }, errors: 0 }))
    return e
  }
  for (const g of linked) {
    if (g.status !== 'installed') continue
    const e = entry(g.recipe_id)
    e.installed = 1
    e.release = installedRelease(official(g.recipe_id)!, g.version, parseJson<GameSource>(g.source, {}).archive)?.version ?? ''
  }
  for (const [game, i] of Object.entries(counts.installs)) if (official(game)) Object.assign(entry(game).installs, i)
  for (const [game, p] of plays) Object.assign(entry(game).plays, { sessions: p.sessions, minutes: Math.round(p.seconds / 60) })
  for (const e of errorRows) entry(e.game).errors += e.count

  const loads = [...counts.client.loads].sort((a, b) => a - b)
  const device = (kind: string) => counts.client.devices[kind] ?? 0
  const browser = (kind: string) => counts.client.browsers[kind] ?? 0
  const dataBytes = (await dirSize(cfg.dataDir).catch(() => ({ bytes: 0 }))).bytes
  const report: Report = {
    schema: 1,
    instance: instanceId(db),
    version: src.version,
    day,
    setup: {
      arch: process.arch === 'arm64' ? 'arm64' : 'x64',
      install: installKind(cfg),
      auth: authKind(cfg, src.accounts),
      adultInstall: src.content.level,
      uptimeDays: Math.floor(process.uptime() / 86_400),
      gamesGB: bucket(games.reduce((n, g) => n + (g.size_bytes || 0), 0), [1, 10, 100, 1000], ['<1', '1-10', '10-100', '100-1000', '>1000']),
      dataGB: bucket(dataBytes, [1, 10, 100], ['<1', '1-10', '10-100', '>100']),
    },
    scale: {
      users: number(db, 'SELECT COUNT(*) n FROM users WHERE disabled = 0'),
      devices: number(db, 'SELECT COUNT(DISTINCT device) n FROM device_people'),
      games: games.length,
      renpyGames: games.filter((g) => g.family === 'renpy').length,
      htmlGames: games.filter((g) => g.family === 'html').length,
      catalogGames: linked.length,
      localGames: games.length - linked.length,
      saves: await src.saveStores.count(),
      mods: games.filter((g) => g.build.includes('.m')).length,
    },
    play: {
      sessions: sessions.reduce((n, s) => n + s.sessions, 0),
      minutes: Math.round(sessions.reduce((n, s) => n + s.seconds, 0) / 60),
      devices: { phone: device('phone'), tablet: device('tablet'), desktop: device('desktop') },
      browsers: { webkit: browser('webkit'), blink: browser('blink'), gecko: browser('gecko') },
      homeScreen: counts.client.homeScreen,
      offline: counts.client.offline,
      controller: counts.client.controller,
      fullscreen: counts.client.fullscreen,
      loadSeconds: { p50: percentile(loads, 0.5), p90: percentile(loads, 0.9) },
      fps: Object.fromEntries(FPS_BUCKETS.map((b) => [b, counts.client.fps[b] ?? 0])),
    },
    features: { walkthroughs: 0, syncCodes: 0, saveImports: 0, artChoices: 0, keptOffline: 0, modBuilds: 0, catalogRefresh: 0, adultLevelsChanged: 0, ...counts.features },
    catalog: [...entries.values()].sort((a, b) => b.installed - a.installed || b.plays.minutes - a.plays.minutes || a.game.localeCompare(b.game)).slice(0, MAX_CATALOG),
    errors: errorRows.sort((a, b) => b.count - a.count).slice(0, MAX_ERRORS),
  }
  // A very large library is cut to what fits: the installed and the most played games stay.
  while (report.catalog.length > 1 && Buffer.byteLength(JSON.stringify(report)) > MAX_BYTES) report.catalog.length = Math.floor(report.catalog.length / 2)
  return report
}
