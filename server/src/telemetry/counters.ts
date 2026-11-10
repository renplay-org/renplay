import type { Db } from '../db.js'

/** What the report counts about how Renplay is used, each a number for the day. */
const FEATURES = ['walkthroughs', 'syncCodes', 'saveImports', 'artChoices', 'keptOffline', 'modBuilds', 'catalogRefresh', 'adultLevelsChanged'] as const
export type Feature = (typeof FEATURES)[number]

export const FPS_BUCKETS = ['under30', '30to50', '50up'] as const
export type FpsBucket = (typeof FPS_BUCKETS)[number]

/** What the players of one day said about themselves, once per session. */
export interface ClientCounts {
  devices: Record<string, number>
  browsers: Record<string, number>
  homeScreen: number
  offline: number
  controller: number
  fullscreen: number
  /** Seconds each session took to load. */
  loads: number[]
  fps: Record<FpsBucket, number>
}

/** One day's counts, kept until the report for that day is sent. */
export interface DayCounts {
  features: Partial<Record<Feature, number>>
  client: ClientCounts
  /** By catalog recipe. `seconds` is the time of the successful installs together. */
  installs: Record<string, { ok: number; failed: number; seconds: number; engine: string }>
  /** By [recipe, kind, message] as JSON. */
  errors: Record<string, number>
}

const KEY = 'telemetry_days'
/** Days kept: the one being counted and the ones before it that a report has not taken yet. */
const KEEP_DAYS = 3
/** Lists the report cannot use more of. */
const MAX_LOADS = 500
const MAX_ERRORS = 200

function empty(): DayCounts {
  return {
    features: {},
    client: { devices: {}, browsers: {}, homeScreen: 0, offline: 0, controller: 0, fullscreen: 0, loads: [], fps: { under30: 0, '30to50': 0, '50up': 0 } },
    installs: {},
    errors: {},
  }
}

/** The UTC day of a time, as 2026-11-10. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The counts of the last few days, kept in the library's settings (so a restart does not lose a
 * day, and the schema stays the one older versions open). Only the telemetry part writes them,
 * and only while it is on.
 */
export class DayCounters {
  private days: Record<string, DayCounts> | null = null

  constructor(private readonly db: Db) {}

  private load(): Record<string, DayCounts> {
    this.days ??= this.db.getSetting<Record<string, DayCounts>>(KEY, {})
    return this.days
  }

  /** The counts of a day, empty when nothing was counted. */
  of(day: string): DayCounts {
    return { ...empty(), ...this.load()[day] }
  }

  /** Changes today's counts and keeps them. */
  edit(change: (counts: DayCounts) => void): void {
    const days = this.load()
    const today = utcDay(Date.now())
    const counts = (days[today] = { ...empty(), ...days[today] })
    change(counts)
    counts.client.loads = counts.client.loads.slice(-MAX_LOADS)
    const errors = Object.entries(counts.errors)
    if (errors.length > MAX_ERRORS) counts.errors = Object.fromEntries(errors.sort((a, b) => b[1] - a[1]).slice(0, MAX_ERRORS))
    for (const day of Object.keys(days).sort().slice(0, -KEEP_DAYS)) delete days[day]
    this.db.setSetting(KEY, days)
  }

  /** Forgets the days up to and including this one: their report is sent. */
  sent(day: string): void {
    const days = this.load()
    for (const d of Object.keys(days)) if (d <= day) delete days[d]
    this.db.setSetting(KEY, days)
  }

  /** Forgets everything: the report was switched off. */
  clear(): void {
    this.days = {}
    this.db.setSetting(KEY, {})
  }
}
