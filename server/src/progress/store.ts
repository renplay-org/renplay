import type { SQLInputValue } from 'node:sqlite'
import type { Db, GameRow } from '../db.js'
import type { PlayStatus } from '../shared/api.js'

/** One person's progress with a game (user_games). */
export interface Progress {
  favorite_at: string
  /** When the status became finished, '' otherwise. */
  finished_at: string
  last_played_at: string
  play_time: number
  /** '' when not set. */
  play_status: PlayStatus | ''
  /** 1 to 5, or 0 for none. */
  rating: number
  /** When the person said Not now: the game leaves Up next until it is played again. */
  not_now_at: string
}

export const NO_PROGRESS: Progress = { favorite_at: '', finished_at: '', last_played_at: '', play_time: 0, play_status: '', rating: 0, not_now_at: '' }

export type GameWithProgress = GameRow & Progress

export const PLAY_STATUSES: ReadonlyArray<PlayStatus | ''> = ['', 'playing', 'stalled', 'dropped', 'finished']

/** A stretch of play, in milliseconds since 1970 and seconds counted. */
export interface PlaySession {
  game: string
  started_at: number
  ended_at: number
  seconds: number
}

/** What each person did with each game: favorites, statuses, ratings, and the play sessions behind their play time. */
export class ProgressStore {
  constructor(private readonly db: Db) {}

  of(user: number, row: GameRow): GameWithProgress {
    const u = this.db.raw.prepare('SELECT favorite_at, finished_at, last_played_at, play_time, play_status, rating, not_now_at FROM user_games WHERE user_id = ? AND game = ?').get(user, row.id) as Partial<Progress> | undefined
    return { ...row, ...NO_PROGRESS, ...u }
  }

  set(user: number, game: string, patch: Partial<Progress>): void {
    this.db.raw.prepare('INSERT OR IGNORE INTO user_games (user_id, game) VALUES (?, ?)').run(user, game)
    for (const [key, value] of Object.entries(patch)) this.db.raw.prepare(`UPDATE user_games SET ${key} = ? WHERE user_id = ? AND game = ?`).run(value as SQLInputValue, user, game)
  }

  /** A favorite keeps the time it first became one. */
  setFavorite(user: number, row: GameRow, on: boolean): void {
    this.set(user, row.id, { favorite_at: on ? this.of(user, row).favorite_at || new Date().toISOString() : '' })
  }

  /** finished_at is when the status became finished. */
  setStatus(user: number, row: GameRow, status: PlayStatus | ''): void {
    const previous = this.of(user, row).finished_at
    this.set(user, row.id, { play_status: status, finished_at: status === 'finished' ? previous || new Date().toISOString() : '' })
  }

  /**
   * Records played seconds as a session (one that ended in the last ten minutes goes on, else a new
   * one starts) and adds the seconds counted to the game's play time.
   */
  addPlayTime(user: number, row: GameRow, seconds: number, now = Date.now()): void {
    const last = this.db.raw.prepare('SELECT id, ended_at FROM play_sessions WHERE user_id = ? AND game = ? AND ended_at >= ? ORDER BY ended_at DESC LIMIT 1').get(user, row.id, now - 10 * 60_000) as { id: number; ended_at: number } | undefined
    let counted = seconds
    // A session grows by at most the time that passed since its last report (and a little slack), so
    // two open windows or a repeated report never count more time than there was.
    if (last) {
      counted = Math.max(0, Math.min(seconds, Math.ceil((now - last.ended_at) / 1000) + 5))
      this.db.raw.prepare('UPDATE play_sessions SET ended_at = ?, seconds = seconds + ? WHERE id = ?').run(now, counted, last.id)
    } else {
      this.db.raw.prepare('INSERT INTO play_sessions (user_id, game, started_at, ended_at, seconds) VALUES (?, ?, ?, ?, ?)').run(user, row.id, now - seconds * 1000, now, seconds)
    }
    if (counted) this.set(user, row.id, { play_time: this.of(user, row).play_time + counted })
  }

  /** A person's sessions, newest first. */
  sessions(user: number): PlaySession[] {
    return this.db.raw.prepare('SELECT game, started_at, ended_at, seconds FROM play_sessions WHERE user_id = ? ORDER BY ended_at DESC').all(user) as unknown as PlaySession[]
  }

  /** The games a person played last, newest first. */
  recentlyPlayed(user: number, limit: number): Array<{ game: string; last_played_at: string }> {
    return this.db.raw.prepare("SELECT game, last_played_at FROM user_games WHERE user_id = ? AND last_played_at != '' ORDER BY last_played_at DESC LIMIT ?").all(user, limit) as Array<{ game: string; last_played_at: string }>
  }

  /** Seconds a person played each game since a time. */
  secondsSince(user: number, since: number): Array<{ game: string; seconds: number }> {
    return this.db.raw.prepare('SELECT game, COALESCE(SUM(seconds), 0) seconds FROM play_sessions WHERE user_id = ? AND started_at >= ? GROUP BY game').all(user, since) as Array<{ game: string; seconds: number }>
  }

  /** Sessions and seconds across everyone. */
  totals(): { sessions: number; seconds: number } {
    return this.db.raw.prepare('SELECT COUNT(*) sessions, COALESCE(SUM(seconds), 0) seconds FROM play_sessions').get() as { sessions: number; seconds: number }
  }

  /** Gives one person's progress to another: the later time and higher rating win, and the sessions move. */
  merge(from: number, to: number): void {
    this.db.raw.prepare(`INSERT INTO user_games (user_id, game, favorite_at, finished_at, last_played_at, play_time, play_status, rating, not_now_at)
      SELECT ?, game, favorite_at, finished_at, last_played_at, play_time, play_status, rating, not_now_at FROM user_games WHERE user_id = ?
      ON CONFLICT(user_id, game) DO UPDATE SET favorite_at = MAX(user_games.favorite_at, excluded.favorite_at), finished_at = MAX(user_games.finished_at, excluded.finished_at), last_played_at = MAX(user_games.last_played_at, excluded.last_played_at), play_time = MAX(user_games.play_time, excluded.play_time),
        play_status = CASE WHEN user_games.play_status = '' THEN excluded.play_status ELSE user_games.play_status END, rating = MAX(user_games.rating, excluded.rating), not_now_at = MAX(user_games.not_now_at, excluded.not_now_at)`).run(to, from)
    // Finished stays in step with finished_at: a game either account finished is finished.
    this.db.raw.prepare("UPDATE user_games SET play_status = 'finished' WHERE user_id = ? AND finished_at IS NOT NULL AND finished_at != '' AND play_status != 'finished'").run(to)
    this.db.raw.prepare("UPDATE user_games SET finished_at = ? WHERE user_id = ? AND play_status = 'finished' AND (finished_at IS NULL OR finished_at = '')").run(new Date().toISOString(), to)
    this.db.raw.prepare('UPDATE play_sessions SET user_id = ? WHERE user_id = ?').run(to, from)
  }

  /** Removes a person's progress and sessions. */
  forget(user: number): void {
    for (const table of ['user_games', 'play_sessions']) this.db.raw.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(user)
  }
}
