import { mkdir, rename } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Router } from 'express'
import { publicUser, validName, validUsername } from '../accounts/accounts.js'
import { viewer, type User } from '../accounts/context.js'
import { passwordHash, random } from '../accounts/passwords.js'
import { parseAdultLevel } from '../shared/levels.js'
import type { Services } from '../services.js'
import { HttpError } from '../util/paths.js'
import type { People, PersonListed } from '../shared/api.js'

/**
 * An admin's work with people: the list, adding, changing and removing them, merging two, and an
 * admin claiming the owner account. Removing and merging touch each person's progress, saves and
 * art, through their stores.
 */
export function createPeopleRouter(s: Services): Router {
  const { cfg, db, accounts, content, progress, saveStores, art } = s
  const router = Router({ caseSensitive: true, strict: true })
  /** People being removed: they cannot be changed or removed again meanwhile. */
  const removing = new Set<number>()

  /** Gives one person's progress, save names and art choices to another. */
  const mergeData = (from: number, to: number): void => {
    progress.merge(from, to)
    saveStores.mergeNotes(from, to)
    art.mergePerson(from, to)
  }

  router.get('/users', async (_req, res) => {
    const users = await Promise.all((db.raw.prepare('SELECT * FROM users').all() as unknown as User[]).map(async (u): Promise<PersonListed> => {
      // Counts follow the admin's own level: an Off admin's counts leave hidden games' saves out.
      const store = saveStores.of(u.id), dirs = content.visibleSaveDirs(await store.listDirs())
      const files = await Promise.all(dirs.map((dir) => store.list(dir)))
      return { ...publicUser(u), games: files.filter((entries) => entries.length > 0).length, saves: files.reduce((n, entries) => n + entries.length, 0), protected: u.id === 1 || u.id === cfg.authUser, ...accounts.managed(u.id) }
    }))
    res.json({ users, adultDefault: cfg.adultDefault } satisfies People)
  })
  router.post('/users', async (req, res) => {
    const login = validUsername(req.body?.username), display = validName(req.body?.name || login), encoded = await passwordHash(req.body?.password)
    if (db.raw.prepare('SELECT 1 FROM users WHERE username = ?').get(login)) throw new HttpError(409, 'That username is taken')
    const role = req.body?.role ?? 'player'
    if (!['admin', 'player'].includes(role)) throw new HttpError(400, 'Choose Admin or Player')
    const ceiling = req.body?.adultCeiling === undefined ? cfg.adultDefault : parseAdultLevel(req.body?.adultCeiling)
    if (!ceiling) throw new HttpError(400, 'Choose Off, Blurred or Shown for the adult games ceiling')
    db.raw.exec('BEGIN IMMEDIATE')
    let id: number
    try {
      id = Number(db.raw.prepare('INSERT INTO users (username, name, role, created_at) VALUES (?, ?, ?, ?)').run(login, display, role, new Date().toISOString()).lastInsertRowid)
      // The ceiling an admin chooses here is also where the person's own choice starts.
      accounts.writeLevels(id, { ceiling, choice: ceiling })
      db.raw.prepare("INSERT INTO identities VALUES ('local', ?, ?, ?)").run(login, id, encoded)
      db.raw.exec('COMMIT')
    } catch (e) { db.raw.exec('ROLLBACK'); throw e }
    await accounts.tag(accounts.user(id)); res.status(201).json({ user: publicUser(accounts.user(id)) })
  })
  router.put('/users/:id', async (req, res) => {
    const target = accounts.user(Number(req.params.id)), b = req.body ?? {}
    if (removing.has(target.id)) throw new HttpError(409, 'This account is being archived')
    if (b.role !== undefined && !['admin', 'player'].includes(b.role)) throw new HttpError(400, 'Choose Admin or Player')
    if (b.disabled !== undefined && typeof b.disabled !== 'boolean') throw new HttpError(400, 'disabled must be a boolean')
    const ceiling = b.adultCeiling === undefined ? undefined : parseAdultLevel(b.adultCeiling) ?? undefined
    if (b.adultCeiling !== undefined && !ceiling) throw new HttpError(400, 'Choose Off, Blurred or Shown for the adult games ceiling')
    const choice = b.adultChoice === undefined ? undefined : parseAdultLevel(b.adultChoice) ?? undefined
    if (b.adultChoice !== undefined && !choice) throw new HttpError(400, 'Choose Off, Blurred or Shown for the adult games choice')
    const managed = accounts.managed(target.id)
    if (b.role !== undefined && managed.roleManaged || ceiling !== undefined && managed.adultManaged) throw new HttpError(409, 'This permission is set by the sign-in provider')
    accounts.guardLastAdmin(target, b)
    db.raw.prepare('UPDATE users SET name = ?, role = ?, disabled = ? WHERE id = ?').run(b.name === undefined ? target.name : validName(b.name), b.role ?? target.role, b.disabled === undefined ? target.disabled : Number(b.disabled), target.id)
    if (ceiling !== undefined || choice !== undefined) accounts.writeLevels(target.id, { ceiling, choice })
    if (b.role !== undefined) db.raw.prepare("UPDATE users SET admin_source = 'manual', admin_provider = '', admin_subject = '' WHERE id = ?").run(target.id)
    accounts.invalidate(); await accounts.tag(accounts.user(target.id)); res.json({ user: publicUser(accounts.user(target.id)) })
  })
  router.post('/users/:id/password', async (req, res) => {
    const target = accounts.user(Number(req.params.id)), encoded = await passwordHash(req.body?.password)
    db.raw.prepare("UPDATE identities SET password = ? WHERE provider = 'local' AND user_id = ?").run(encoded, target.id)
    accounts.revoke(target.id); res.json({ ok: true })
  })
  const remove = async (id: number) => {
    const u = accounts.user(id)
    if (id === 1 || id === cfg.authUser) throw new HttpError(409, 'The no-sign-in account must stay')
    if (removing.has(id)) throw new HttpError(409, 'This account is being archived')
    accounts.guardLastAdmin(u, {}, true)
    const store = saveStores.of(id), source = saveStores.folder(id)
    const destination = join(cfg.dataDir, 'users-removed', `${id}-${Date.now()}`)
    removing.add(id)
    // Reserve the removal synchronously: two concurrent removals cannot both pass the last-admin check.
    db.raw.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(id)
    accounts.invalidate()
    try {
      await store.pauseWrites()
      await mkdir(join(cfg.dataDir, 'users-removed'), { recursive: true })
      await rename(source, destination)
      db.raw.exec('BEGIN IMMEDIATE')
      try {
        db.raw.prepare('DELETE FROM identity_metadata WHERE (provider, subject) IN (SELECT provider, subject FROM identities WHERE user_id = ?)').run(id)
        for (const table of ['sessions', 'tokens', 'identities', 'device_people']) db.raw.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id)
        progress.forget(id)
        saveStores.forget(id)
        art.forgetPerson(id)
        db.raw.prepare('DELETE FROM users WHERE id = ?').run(id)
        db.raw.exec('COMMIT')
      } catch (error) {
        db.raw.exec('ROLLBACK')
        await rename(destination, source)
        throw error
      }
      accounts.invalidate()
    } catch (error) {
      db.raw.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(u.disabled, id)
      store.resumeWrites()
      throw error
    } finally { removing.delete(id) }
  }
  router.post('/me/claim-owner', async (_req, res) => {
    const u = accounts.current(), { session, bearer } = viewer()!
    if (u.role !== 'admin') throw new HttpError(403, 'Only an admin can claim the owner account')
    if (!accounts.unclaimed) throw new HttpError(409, 'The owner account is already claimed')
    if (u.id === 1) throw new HttpError(409, 'Use the setup code to choose the owner password')
    if (u.id === cfg.authUser) throw new HttpError(409, 'Choose the owner as RENPLAY_AUTH_USER before claiming it')
    const reservation = random()
    db.raw.exec('BEGIN IMMEDIATE')
    try {
      if (!accounts.unclaimed) throw new HttpError(409, 'The owner account is already claimed')
      db.setSetting('owner_claim', reservation)
      db.raw.exec('COMMIT')
    } catch (error) { db.raw.exec('ROLLBACK'); throw error }
    try {
      await saveStores.copy(u.id, 1)
      db.raw.exec('BEGIN IMMEDIATE')
      try {
        // The copy can take a while. Check again that the claimant is still signed in, enabled
        // and an admin, and carry over their permissions as they are now, so a role or grant
        // removed meanwhile is not restored through the owner account.
        accounts.requireLiveLink(u.id, session, bearer)
        const now = db.raw.prepare('SELECT * FROM users WHERE id = ?').get(u.id) as unknown as User | undefined
        if (!now || now.disabled || now.role !== 'admin') throw new HttpError(403, 'Only an admin can claim the owner account')
        mergeData(u.id, 1)
        db.raw.prepare('UPDATE users SET username = ? WHERE id = ?').run(`archived-${u.id}-${randomBytes(4).toString('hex')}`, u.id)
        db.raw.prepare("UPDATE users SET username = ?, name = ?, role = 'admin', avatar = ?, avatar_uploaded = ?, admin_source = ?, admin_provider = ?, admin_subject = ? WHERE id = 1").run(now.username, now.name, now.avatar, now.avatar_uploaded, now.admin_source, now.admin_provider, now.admin_subject)
        accounts.writeLevels(1, { ceiling: parseAdultLevel(now.adult_ceiling) ?? cfg.adultDefault, choice: parseAdultLevel(now.adult_choice) ?? cfg.adultDefault })
        db.raw.prepare('UPDATE identities SET user_id = 1 WHERE user_id = ?').run(u.id)
        db.raw.prepare('UPDATE sessions SET user_id = 1 WHERE hash = ?').run(session)
        db.raw.prepare('UPDATE tokens SET user_id = 1 WHERE hash = ?').run(session)
        db.raw.exec('COMMIT')
      } catch (e) { db.raw.exec('ROLLBACK'); throw e }
      await remove(u.id)
      await accounts.tag(accounts.user(1)); accounts.ownerClaimed(); accounts.invalidate()
      res.json({ ok: true })
    } finally {
      db.raw.prepare("DELETE FROM settings WHERE key = 'owner_claim' AND value = ?").run(JSON.stringify(reservation))
    }
  })
  router.post('/users/:id/merge', async (req, res) => {
    const id = Number(req.params.id), target = Number(req.body?.target)
    if (id === 1 || id === cfg.authUser) throw new HttpError(409, 'The no-sign-in account must stay')
    accounts.guardLastAdmin(accounts.user(id), {}, true)
    const copied = await saveStores.copy(id, target)
    mergeData(id, target)
    await remove(id); res.json({ copied })
  })
  router.delete('/users/:id', async (req, res) => { await remove(Number(req.params.id)); res.json({ ok: true }) })

  return router
}
