import { randomBytes } from 'node:crypto'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import type { ArtStore } from '../art/store.js'
import type { ProgressStore } from '../progress/store.js'
import type { SaveStores } from '../saves/stores.js'
import { HttpError } from '../util/paths.js'
import { log } from '../util/log.js'
import type { Purger } from '../util/purge.js'
import { isVisitorKey } from '../shared/demo-embed.js'
import { hash } from './passwords.js'

/** What a guest's removal needs to forget about them. */
export interface GuestParts {
  saveStores: SaveStores
  progress: ProgressStore
  art: ArtStore
  purger: Purger
  /** Lets the account code forget the sessions it keeps in memory. */
  forgetSessions: () => void
}

/** What a key is kept as: a hash that names a guest and nothing else. */
const keyHash = (key: string) => hash(`renplay-demo-visitor\n${key}`)

/**
 * The public demo's guests: one for each visitor, found again by the visitor key the website's
 * frames share. A guest is an ordinary player with the demo's limits. Idle guests go, and the
 * number of guests and of new ones from one address is bounded, so the demo fits its small host.
 * Only a demo has any of this.
 */
export class DemoGuests {
  private readonly made = new Map<string, { count: number; until: number }>()
  /** Making and removing guests happen one at a time, so two frames with one key make one guest. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly db: Db, private readonly cfg: Config, private readonly parts: GuestParts) {}

  init(): void {
    this.db.raw.exec('CREATE TABLE IF NOT EXISTS demo_guests (user_id INTEGER PRIMARY KEY, key_hash TEXT UNIQUE, seen_at INTEGER NOT NULL)')
  }

  isGuest(id: number): boolean {
    return !!this.db.raw.prepare('SELECT 1 FROM demo_guests WHERE user_id = ?').get(id)
  }

  /** The guest of a visitor key, if it has one. */
  find(key: string): number | null {
    const row = this.db.raw.prepare('SELECT user_id FROM demo_guests WHERE key_hash = ?').get(keyHash(key)) as { user_id: number } | undefined
    return row?.user_id ?? null
  }

  /** Notes that the guest was seen. */
  seen(id: number, now = Date.now()): void {
    this.db.raw.prepare('UPDATE demo_guests SET seen_at = ? WHERE user_id = ?').run(now, id)
  }

  /** Keeps the newest sessions of a guest: the frames of one visitor, not a pile of every reload. */
  trimSessions(id: number): void {
    this.db.raw.prepare('DELETE FROM sessions WHERE user_id = ? AND hash NOT IN (SELECT hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)').run(id, id, this.cfg.demoGuests.sessions)
  }

  /**
   * Who a visitor is, from what they sent and the session they came with. A visitor who is already
   * the key's guest, or a guest when there is no key, needs no new session.
   */
  async arrive(body: unknown, current: number | undefined, address: string, session: () => void): Promise<{ guest: number; keyed: boolean } | null> {
    const sent = (body as { visitor?: unknown } | undefined)?.visitor
    if (sent !== undefined && !isVisitorKey(sent)) throw new HttpError(400, 'That visitor key is not valid')
    const key = sent ?? null
    const here = current !== undefined && this.isGuest(current) ? current : null
    if (here !== null && (!key || this.find(key) === here)) { this.seen(here); return null }
    session()
    return { guest: await this.enter(key, address), keyed: !!key }
  }

  /** The guest for a visitor key, made if there is none. Without a key it is a new guest. */
  private enter(key: string | null, address: string): Promise<number> {
    return this.serial(async () => {
      const existing = key && this.find(key)
      if (existing) { this.seen(existing); return existing }
      this.spend(address)
      while ((this.db.raw.prepare('SELECT COUNT(*) n FROM demo_guests').get() as { n: number }).n >= this.cfg.demoGuests.max) await this.removeOldest()
      return this.create(key)
    })
  }

  /** Whether the guest has gone unseen for the idle time, as of now. */
  private idle(id: number): boolean {
    return !!this.db.raw.prepare('SELECT 1 FROM demo_guests WHERE user_id = ? AND seen_at < ?').get(id, Date.now() - this.cfg.demoGuests.idleMs)
  }

  /** Removes the guests nobody has seen for the idle time. Returns how many went. */
  sweep(): Promise<number> {
    return this.serial(async () => {
      const gone = this.db.raw.prepare('SELECT user_id FROM demo_guests WHERE seen_at < ?').all(Date.now() - this.cfg.demoGuests.idleMs) as Array<{ user_id: number }>
      let removed = 0
      for (const { user_id } of gone) {
        // Removing the guests before took time: this one may have been seen since it was chosen.
        if (!this.idle(user_id)) continue
        try { await this.remove(user_id); removed++ } catch (e) { log('demo', `Could not remove an idle guest: ${e instanceof Error ? e.message : e}`) }
      }
      if (removed) log('demo', `Removed ${removed} idle ${removed === 1 ? 'guest' : 'guests'}`)
      return removed
    })
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => {})
    return next
  }

  /** Counts a new guest against the address, an hour at a time. */
  private spend(address: string): void {
    const now = Date.now()
    for (const [k, bucket] of this.made) if (bucket.until <= now) this.made.delete(k)
    const bucket = this.made.get(address) ?? { count: 0, until: now + 3600_000 }
    if (bucket.count >= this.cfg.demoGuests.newPerHour) throw new HttpError(429, 'Too many new guests from this address. Try again in an hour.')
    bucket.count++
    this.made.set(address, bucket)
  }

  private create(key: string | null): number {
    const now = Date.now()
    this.db.raw.exec('BEGIN IMMEDIATE')
    try {
      const id = Number(this.db.raw.prepare("INSERT INTO users (username, name, role, adult_ceiling, adult_choice, created_at) VALUES (?, 'Guest', 'player', 'blurred', 'blurred', ?)").run(`guest-${randomBytes(6).toString('hex')}`, new Date(now).toISOString()).lastInsertRowid)
      this.db.raw.prepare('INSERT INTO demo_guests (user_id, key_hash, seen_at) VALUES (?, ?, ?)').run(id, key ? keyHash(key) : null, now)
      this.db.raw.exec('COMMIT')
      return id
    } catch (e) { this.db.raw.exec('ROLLBACK'); throw e }
  }

  private async removeOldest(): Promise<void> {
    const oldest = this.db.raw.prepare('SELECT user_id FROM demo_guests ORDER BY seen_at, user_id LIMIT 1').get() as { user_id: number } | undefined
    if (!oldest) return
    await this.remove(oldest.user_id)
  }

  /** A guest goes with everything of theirs: saves, progress, choices and sessions. */
  private async remove(id: number): Promise<void> {
    const { saveStores, progress, art, purger } = this.parts
    const folder = saveStores.folder(id), store = saveStores.of(id)
    // Stop the guest first, so a request in flight cannot write into a folder that is going.
    this.db.raw.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(id)
    this.parts.forgetSessions()
    await store.pauseWrites()
    this.db.raw.exec('BEGIN IMMEDIATE')
    try {
      for (const table of ['sessions', 'tokens', 'identities', 'device_people', 'demo_guests']) this.db.raw.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id)
      progress.forget(id)
      saveStores.forget(id)
      art.forgetPerson(id)
      this.db.raw.prepare('DELETE FROM users WHERE id = ?').run(id)
      this.db.raw.exec('COMMIT')
    } catch (e) {
      this.db.raw.exec('ROLLBACK')
      this.db.raw.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(id)
      store.resumeWrites()
      throw e
    }
    this.parts.forgetSessions()
    await purger.purge(folder)
  }
}
