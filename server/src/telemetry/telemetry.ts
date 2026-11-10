import type { GameRow } from '../db.js'
import { log } from '../util/log.js'
import { USER_AGENT } from '../util/version.js'
import { cleanError } from './clean.js'
import { DayCounters, FPS_BUCKETS, utcDay, type DayCounts, type Feature, type FpsBucket } from './counters.js'
import { buildReport, type ReportSources } from './report.js'

const SETTING = 'telemetry'
const MINUTE = 60_000
/** The first report comes 10 to 60 minutes after the start, the next ones a day and up to an hour later. */
const FIRST_MIN = 10 * MINUTE
const FIRST_SPREAD = 50 * MINUTE
const EVERY = 24 * 60 * MINUTE
const JITTER = 60 * MINUTE
const LAST_SENT = 'telemetry_sent'

const DEVICES = new Set(['phone', 'tablet', 'desktop'])
const BROWSERS = new Set(['webkit', 'blink', 'gecko'])

/** What a player says about one session of play (POST /api/telemetry/client). Every part is optional. */
export interface ClientReport {
  device?: unknown
  browser?: unknown
  homeScreen?: unknown
  offline?: unknown
  controller?: unknown
  fullscreen?: unknown
  loadSeconds?: unknown
  fps?: unknown
  error?: unknown
}

/** The bucket of a frame rate. */
function fpsBucket(fps: number): FpsBucket {
  return fps < 30 ? FPS_BUCKETS[0] : fps < 50 ? FPS_BUCKETS[1] : FPS_BUCKETS[2]
}

/**
 * The anonymous usage report: what is counted, the report made from it, and its daily sending.
 * Off (RENPLAY_TELEMETRY=off, or the switch in Settings) nothing is counted and nothing is sent.
 * The privacy lines are in docs/site/src/content/docs/telemetry.md.
 */
export class Telemetry {
  private readonly counters: DayCounters
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly src: ReportSources) {
    this.counters = new DayCounters(src.db)
  }

  /** True when the report is on: the variable decides when it is set, else the switch (on by default). */
  enabled(): boolean {
    return this.src.cfg.telemetry ? this.src.cfg.telemetry === 'on' : this.src.db.getSetting<boolean>(SETTING, true)
  }

  /** For Settings: whether it is on, whether the server fixes it, and whether an admin chose. */
  status(): { on: boolean; locked: boolean; chosen: boolean } {
    return { on: this.enabled(), locked: !!this.src.cfg.telemetry, chosen: this.src.db.getSetting<unknown>(SETTING, null) !== null }
  }

  /** The admin's switch. Turning it off forgets what was counted. */
  set(on: boolean): void {
    this.src.db.setSetting(SETTING, on)
    if (!on) this.counters.clear()
  }

  /** One use of a feature (a walkthrough added, a catalog refresh and so on). */
  feature(name: Feature): void {
    if (!this.enabled()) return
    this.counters.edit((c) => void (c.features[name] = (c.features[name] ?? 0) + 1))
  }

  /**
   * Counts an install by its catalog recipe: how it ended, how long it took, the engine, and
   * the first line of the error. An install the person cancelled counts as nothing.
   */
  async install<T extends { recipe?: string | null; engine?: string }>(job: { params: { game?: string; recipeId?: string; source: { path: string } }; signal: AbortSignal }, run: () => Promise<T>): Promise<T> {
    const started = Date.now()
    try {
      const result = await run()
      this.installed(result.recipe ?? '', true, Date.now() - started, result.engine ?? '')
      return result
    } catch (error) {
      if (!job.signal.aborted) {
        const { params } = job
        const recipe = params.recipeId || this.src.db.getGame(params.game ?? '')?.recipe_id || this.src.catalog.match({ name: params.source.path })?.recipe.id || ''
        this.installed(recipe, false, Date.now() - started, '', error instanceof Error ? error.message : String(error))
      }
      throw error
    }
  }

  private installed(recipe: string, ok: boolean, ms: number, engine: string, message = ''): void {
    if (!this.enabled() || !this.src.catalog.officialRecipe(recipe)) return
    this.counters.edit((c) => {
      const i = (c.installs[recipe] ??= { ok: 0, failed: 0, seconds: 0, engine: '' })
      if (ok) {
        i.ok++
        i.seconds += Math.round(ms / 1000)
        if (engine) i.engine = engine
      } else i.failed++
      if (!ok) this.addError(c, recipe, 'install', message)
    })
  }

  /** A problem in a game while it ran or synced, by the first line of its message. */
  error(game: GameRow | null, kind: 'runtime' | 'sync', message: unknown): void {
    if (!this.enabled() || !game?.recipe_id || !this.src.catalog.officialRecipe(game.recipe_id)) return
    this.counters.edit((c) => this.addError(c, game.recipe_id, kind, message))
  }

  private addError(c: DayCounts, game: string, kind: string, message: unknown): void {
    const key = JSON.stringify([game, kind, cleanError(message)])
    c.errors[key] = (c.errors[key] ?? 0) + 1
  }

  /** What a player says about one session. Anything that is not one of the known values is left out. */
  client(report: ClientReport, game: GameRow | null): void {
    if (!this.enabled()) return
    const flag = (v: unknown) => v === true
    const seconds = typeof report.loadSeconds === 'number' && Number.isFinite(report.loadSeconds) && report.loadSeconds >= 0 && report.loadSeconds < 3600 ? report.loadSeconds : null
    this.counters.edit((c) => {
      const k = c.client
      if (typeof report.device === 'string' && DEVICES.has(report.device)) k.devices[report.device] = (k.devices[report.device] ?? 0) + 1
      if (typeof report.browser === 'string' && BROWSERS.has(report.browser)) k.browsers[report.browser] = (k.browsers[report.browser] ?? 0) + 1
      if (flag(report.homeScreen)) k.homeScreen++
      if (flag(report.offline)) k.offline++
      if (flag(report.controller)) k.controller++
      if (flag(report.fullscreen)) k.fullscreen++
      if (seconds !== null) k.loads.push(seconds)
      if (typeof report.fps === 'number' && Number.isFinite(report.fps) && report.fps >= 0) k.fps[fpsBucket(report.fps)]++
    })
    if (typeof report.error === 'string' && report.error.trim()) this.error(game, 'runtime', report.error)
  }

  // ---- sending ------------------------------------------------------------

  /** Begins the daily sending: the first report 10 to 60 minutes from now. */
  start(): void {
    this.schedule(FIRST_MIN + Math.random() * FIRST_SPREAD)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(ms: number): void {
    this.stop()
    this.timer = setTimeout(() => void this.send().finally(() => this.schedule(EVERY + Math.random() * JITTER)), ms)
    this.timer.unref()
  }

  /**
   * Sends the report of the last whole UTC day, once. A failed send is dropped (that day's report
   * is not tried again), and the answer is ignored. Nothing is sent when it is off.
   */
  async send(): Promise<void> {
    if (!this.enabled()) return
    const day = utcDay(Date.now() - 86_400_000)
    if (this.src.db.getSetting<string>(LAST_SENT, '') >= day) return
    try {
      const report = await buildReport(this.src, day, this.counters.of(day))
      this.src.db.setSetting(LAST_SENT, day)
      this.counters.sent(day)
      const res = await fetch(this.src.cfg.telemetryUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(15_000),
      })
      await res.body?.cancel().catch(() => {})
      log('telemetry', `Sent the report for ${day} (${res.status})`, 'debug')
    } catch (error) {
      log('telemetry', `Could not send the report: ${(error as Error).message}`, 'debug')
    }
  }
}
