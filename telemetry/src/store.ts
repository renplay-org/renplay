// What the collector keeps (schema.sql). The instance row and the instance's day are the only rows
// with an instance id. Everything about games is added to the day's counters with no instance id.
import type { Report } from './validate'

const HOUR = 3_600_000
export const RATE_WINDOW = 20 * HOUR
export const RATE_LIMIT = 3
export const KEEP_DAYS = 400

/** Whether the instance has already reported RATE_LIMIT times in the last 20 hours. */
export async function limited(db: D1Database, instance: string, now: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT count(*) AS n FROM rate_limits WHERE instance = ?1 AND at > ?2')
    .bind(instance, now - RATE_WINDOW)
    .first<{ n: number }>()
  return (row?.n ?? 0) >= RATE_LIMIT
}

/**
 * Counts a report. An instance counts once a day: a second report for the same day only takes up part
 * of the rate limit, so the day's counters are never added twice.
 */
export async function write(db: D1Database, r: Report, now: number): Promise<void> {
  const log = db.prepare('INSERT INTO rate_limits (instance, at) VALUES (?1, ?2)').bind(r.instance, now)
  const seen = await db.prepare('SELECT 1 AS seen FROM instance_days WHERE day = ?1 AND id = ?2').bind(r.day, r.instance).first()
  if (seen) {
    await log.run()
    return
  }

  const s = r.setup
  const statements = [
    log,
    db
      .prepare(
        `INSERT INTO instances (id, first_day, last_day, version, arch, install, auth, adult_install, games_gb, data_gb)
         VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT (id) DO UPDATE SET
           first_day = min(instances.first_day, excluded.first_day),
           version = CASE WHEN excluded.last_day >= instances.last_day THEN excluded.version ELSE instances.version END,
           arch = CASE WHEN excluded.last_day >= instances.last_day THEN excluded.arch ELSE instances.arch END,
           install = CASE WHEN excluded.last_day >= instances.last_day THEN excluded.install ELSE instances.install END,
           auth = CASE WHEN excluded.last_day >= instances.last_day THEN excluded.auth ELSE instances.auth END,
           adult_install = CASE WHEN excluded.last_day >= instances.last_day THEN excluded.adult_install ELSE instances.adult_install END,
           games_gb = CASE WHEN excluded.last_day >= instances.last_day THEN excluded.games_gb ELSE instances.games_gb END,
           data_gb = CASE WHEN excluded.last_day >= instances.last_day THEN excluded.data_gb ELSE instances.data_gb END,
           last_day = max(instances.last_day, excluded.last_day)`,
      )
      .bind(r.instance, r.day, r.version, s.arch, s.install, s.auth, s.adultInstall, s.gamesGB, s.dataGB),
    db.prepare('INSERT INTO instance_days (day, id, version) VALUES (?1, ?2, ?3)').bind(r.day, r.instance, r.version),
  ]

  // One statement per table, with the rows as one JSON parameter: D1 allows few statements per request.
  if (Object.keys(r.usage).length) {
    statements.push(
      db
        .prepare(
          `INSERT INTO usage_days (day, key, value) SELECT ?1, key, value FROM json_each(?2) WHERE true
           ON CONFLICT (day, key) DO UPDATE SET value = usage_days.value + excluded.value`,
        )
        .bind(r.day, JSON.stringify(r.usage)),
    )
  }
  if (r.catalog.length) {
    statements.push(
      db
        .prepare(
          `INSERT INTO game_days (day, game, "release", installed, installs_ok, installs_failed, install_seconds, plays_sessions, plays_minutes, errors)
           SELECT ?1, json_extract(value, '$.game'), json_extract(value, '$.release'), json_extract(value, '$.installed'),
                  json_extract(value, '$.installsOk'), json_extract(value, '$.installsFailed'), json_extract(value, '$.installSeconds'),
                  json_extract(value, '$.playsSessions'), json_extract(value, '$.playsMinutes'), json_extract(value, '$.errors')
           FROM json_each(?2) WHERE true
           ON CONFLICT (day, game, "release") DO UPDATE SET
             installed = game_days.installed + excluded.installed,
             installs_ok = game_days.installs_ok + excluded.installs_ok,
             installs_failed = game_days.installs_failed + excluded.installs_failed,
             install_seconds = game_days.install_seconds + excluded.install_seconds,
             plays_sessions = game_days.plays_sessions + excluded.plays_sessions,
             plays_minutes = game_days.plays_minutes + excluded.plays_minutes,
             errors = game_days.errors + excluded.errors`,
        )
        .bind(r.day, JSON.stringify(r.catalog)),
    )
  }
  if (r.errors.length) {
    statements.push(
      db
        .prepare(
          `INSERT INTO error_days (day, game, kind, message, count)
           SELECT ?1, json_extract(value, '$.game'), json_extract(value, '$.kind'), json_extract(value, '$.message'), json_extract(value, '$.count')
           FROM json_each(?2) WHERE true
           ON CONFLICT (day, game, kind, message) DO UPDATE SET count = error_days.count + excluded.count`,
        )
        .bind(r.day, JSON.stringify(r.errors)),
    )
  }
  await db.batch(statements)
}

/** Deletes what is older than 400 days, and the rate limit rows older than a day. */
export async function purge(db: D1Database, now: number): Promise<void> {
  const cutoff = new Date(now - KEEP_DAYS * 24 * HOUR).toISOString().slice(0, 10)
  await db.batch([
    db.prepare('DELETE FROM instance_days WHERE day < ?1').bind(cutoff),
    db.prepare('DELETE FROM game_days WHERE day < ?1').bind(cutoff),
    db.prepare('DELETE FROM error_days WHERE day < ?1').bind(cutoff),
    db.prepare('DELETE FROM usage_days WHERE day < ?1').bind(cutoff),
    db.prepare('DELETE FROM instances WHERE last_day < ?1').bind(cutoff),
    db.prepare('DELETE FROM rate_limits WHERE at < ?1').bind(now - 24 * HOUR),
  ])
}
