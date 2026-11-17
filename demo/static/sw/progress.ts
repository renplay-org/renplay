/** The guest's progress: a game as the library shows it, its play time, and the play history. */
import type { Game, HistoryPage } from '../../../server/src/shared/api'
import { slotInfo } from '../../../server/src/shared/saveslot'
import { fail, json } from './http'
import { filesOf, isSlotFile, metaOf, screenshotUrl } from './saves'
import type { Env, Progress } from './types'

/** A game as the library shows it: the snapshot's game with this browser's saves and progress. */
export async function project(env: Env, g: Game): Promise<Game> {
  const p = (await env.store.get('progress', g.id)) ?? { id: g.id }
  const files = g.saveDir ? (await filesOf(env, g.saveDir)).filter((f) => isSlotFile(f.name) && !f.name.startsWith('_')) : []
  let latest: Game['latestSave'] = null
  for (const f of files) {
    const meta = await metaOf(f)
    if (!meta) continue
    const ctime = meta.ctime ? meta.ctime * 1000 : f.mtime
    if (!latest || ctime > latest.ctime) {
      latest = { file: f.name, label: slotInfo(f.name).label, name: meta.name ?? '', ctime, runtime: meta.runtime, screenshot: meta.hasScreenshot ? screenshotUrl(g.id, f.name, f.mtime) : null }
    }
  }
  return {
    ...g,
    favoriteAt: p.favoriteAt ?? null,
    finishedAt: p.finishedAt ?? null,
    playTime: p.playTime ?? 0,
    playStatus: (p.playStatus as Game['playStatus']) ?? null,
    rating: p.rating || null,
    notNowAt: p.notNowAt ?? null,
    latestSave: latest,
    lastPlayedAt: p.lastPlayedAt ?? null,
    saves: { count: files.length, latest: files.reduce((m, f) => Math.max(m, f.mtime), 0) },
  }
}

async function setProgress(env: Env, id: string, patch: Partial<Progress>): Promise<void> {
  const row = (await env.store.get('progress', id)) ?? { id }
  await env.store.put('progress', { ...row, ...patch, id })
  env.notify()
}

/** The routes of /api/games/:id: the game itself, and the time the guest plays it. Favourites, status and rating are not kept: the demo is for playing. */
export async function gameRoute(env: Env, req: Request, game: Game, rest: string, body: () => Promise<Record<string, unknown>>): Promise<Response | null> {
  const m = req.method
  if (rest === '' && m === 'GET') return json({ game: await project(env, game) })
  if (rest === '/play-time' && m === 'POST') {
    const seconds = (await body()).seconds
    if (!Number.isInteger(seconds) || (seconds as number) < 1 || (seconds as number) > 60) return fail(400, 'Seconds must be an integer from 1 to 60')
    const p = await env.store.get('progress', game.id)
    await setProgress(env, game.id, { playTime: (p?.playTime ?? 0) + (seconds as number) })
    return json({ ok: true })
  }
  if (rest === '/played' && m === 'POST') {
    await setProgress(env, game.id, { lastPlayedAt: new Date().toISOString() })
    return json({ ok: true })
  }
  return null
}

/** The play history: one session per game, made of the time the guest has played. */
export async function history(env: Env, url: URL, games: Game[]): Promise<HistoryPage> {
  const only = url.searchParams.get('game')
  const rows = []
  for (const g of games) {
    if (only && g.id !== only) continue
    const p = await env.store.get('progress', g.id)
    if (!p?.playTime) continue
    rows.push({ id: g.id, title: g.title, nsfw: g.nsfw, seconds: p.playTime, sessions: 1, lastPlayedAt: p.lastPlayedAt ? Date.parse(p.lastPlayedAt) : Date.now(), rating: p.rating || null, playStatus: (p.playStatus as Game['playStatus']) ?? null, icon: g.art.icon ?? null })
  }
  return { totals: { seconds: rows.reduce((n, r) => n + r.seconds, 0), sessions: rows.length, games: rows.length, since: null }, days: [], games: rows, next: null }
}
