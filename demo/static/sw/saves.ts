/** The guest's saves with their history, notes and pins, in the visitor's store. The routes of /api/saves/:id. */
import type { Game, SaveSlot, SaveVersions, SavesResponse } from '../../../server/src/shared/api'
import { slotInfo } from '../../../server/src/shared/saveslot'
import { Refusal, fail, json, sha1 } from './http'
import type { Env, FileRow, NoteRow, VersionRow } from './types'
import { readSave, type SaveMeta } from './zip'

/** The demo's own limits for the guest: a save file, all saves, the files kept, and the versions of each. */
const LIMITS = { file: 2 << 20, total: 32 << 20, files: 1000, versions: 3 }
/** The folders every game of a person shares. */
const SHARED = ['tokens', 'persistent']

const metaCache = new Map<string, SaveMeta | null>()
export async function metaOf(row: FileRow): Promise<SaveMeta | null> {
  const key = `${row.key}/${row.mtime}/${row.data.byteLength}`
  if (!metaCache.has(key)) metaCache.set(key, await readSave(row.data))
  return metaCache.get(key)!
}

const cleanRel = (raw: string | null): string => {
  if (!raw || /[\\\x00-\x1f]/.test(raw) || raw.split('/').some((p) => !p || p === '.' || p === '..')) throw new Refusal(400, 'Invalid path')
  return raw
}

export const isSlotFile = (name: string) => name.endsWith('.save') && !name.includes('/')

export const screenshotUrl = (id: string, file: string, mtime: number) => `/api/saves/${id}/screenshot?user=1&file=${encodeURIComponent(file)}&v=${mtime}`

/** The files of one save folder. */
export async function filesOf(env: Env, dir: string): Promise<FileRow[]> {
  return (await env.store.all('files')).filter((f) => f.dir === dir)
}

const base64 = (data: ArrayBuffer) => {
  const bytes = new Uint8Array(data)
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

/** Earlier copies of a file, newest first, at most three: the guest's limit on the demo server. */
async function keepVersion(env: Env, row: FileRow, reason: string): Promise<void> {
  const id = `${row.key.replace(/\//g, '__')}/${Date.now()}__${reason}__${(await sha1(row.data)).slice(0, 10)}`
  await env.store.put('versions', { id, key: row.key, dir: row.dir, name: row.name, data: row.data, savedAt: Date.now(), reason } satisfies VersionRow)
  // A pinned save keeps every version.
  if ((await env.store.get('notes', row.key))?.pinnedAt) return
  const all = (await env.store.all('versions')).filter((v) => v.key === row.key).sort((a, b) => b.savedAt - a.savedAt)
  for (const old of all.slice(LIMITS.versions)) await env.store.del('versions', old.id)
}

async function slotsOf(env: Env, game: Game): Promise<SavesResponse> {
  const dir = game.saveDir
  if (!dir) return { saveDir: null, slots: [], other: [], conflicts: [] }
  const notes = new Map((await env.store.all('notes')).map((n) => [n.key, n]))
  const slots: SaveSlot[] = []
  const other: SavesResponse['other'] = []
  for (const f of await filesOf(env, dir)) {
    if (!isSlotFile(f.name)) {
      other.push({ name: f.name, size: f.data.byteLength, mtime: f.mtime })
      continue
    }
    const info = slotInfo(f.name)
    const meta = await metaOf(f)
    const note = notes.get(f.key)
    slots.push({
      file: f.name, size: f.data.byteLength, mtime: f.mtime, kind: info.kind, label: info.label, page: info.page, slot: info.slot,
      name: meta?.name ?? '', ctime: meta?.ctime ? meta.ctime * 1000 : f.mtime, renpyVersion: meta?.renpyVersion, gameVersion: meta?.gameVersion, runtime: meta?.runtime,
      screenshot: meta?.hasScreenshot ? screenshotUrl(game.id, f.name, f.mtime) : null, screenshotHash: null,
      valid: !!meta, title: note?.title || null, note: note?.note || null, pinnedAt: note?.pinnedAt || null,
    })
  }
  slots.sort((a, b) => b.ctime - a.ctime)
  return { saveDir: dir, slots, other, conflicts: [], sync: false }
}

/** A save's name and note: text of the server's own lengths, and a pin. */
async function setNote(env: Env, dir: string, file: string, b: { title?: unknown; note?: unknown; pinned?: unknown }): Promise<Response> {
  for (const [key, max] of [['title', 80], ['note', 500]] as const)
    if (b[key] !== undefined && (typeof b[key] !== 'string' || (b[key] as string).length > max)) return fail(400, `The ${key === 'title' ? 'name' : 'note'} is text of up to ${max} characters`)
  if (b.pinned !== undefined && typeof b.pinned !== 'boolean') return fail(400, 'Pinned must be true or false')
  const key = `${dir}/${file}`
  const row = (await env.store.get('notes', key)) ?? { key, title: '', note: '', pinnedAt: '' }
  const next: NoteRow = {
    key,
    title: b.title !== undefined ? (b.title as string).trim() : row.title,
    note: b.note !== undefined ? (b.note as string).trim() : row.note,
    pinnedAt: b.pinned === undefined ? row.pinnedAt : b.pinned ? row.pinnedAt || new Date().toISOString() : '',
  }
  await env.store.put('notes', next)
  env.notify()
  return json({ ok: true, title: next.title || null, note: next.note || null, pinnedAt: next.pinnedAt || null })
}

/** The save routes the demo answers. The rest of a save folder's routes (imports, copies, Sync codes, exports) are not here. */
export async function savesRoute(env: Env, req: Request, url: URL, game: Game, rest: string): Promise<Response | null> {
  const dir = game.saveDir
  const method = req.method
  const resolve = (): { dir: string; name: string } => {
    const rel = cleanRel(url.searchParams.get('path'))
    const slash = rel.indexOf('/')
    if (slash === -1) throw new Refusal(400, 'Path must be inside a save folder')
    return { dir: rel.slice(0, slash), name: rel.slice(slash + 1) }
  }
  const rowAt = async (file: string) => (dir ? env.store.get('files', `${dir}/${file}`) : undefined)
  if (rest === '' && method === 'GET') return json(await slotsOf(env, game))
  if (rest === '/boot' && method === 'GET') {
    const files = (await env.store.all('files')).filter((f) => f.dir === dir || SHARED.includes(f.dir)).map((f) => ({ path: f.key, data: base64(f.data), mtime: f.mtime }))
    return json({ saveDir: dir, files, lazy: [], serverTime: Date.now() })
  }
  if (rest === '/raw' && method === 'GET') {
    const { dir: d, name } = resolve()
    const row = await env.store.get('files', `${d}/${name}`)
    if (!row) return fail(404, 'Not found')
    return new Response(row.data, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-renplay-mtime': String(row.mtime) } })
  }
  if (rest === '/file' && method === 'PUT') {
    const { dir: d, name } = resolve()
    const data = await req.arrayBuffer()
    if (data.byteLength > LIMITS.file) return fail(413, `A save here can be at most ${LIMITS.file >> 20} MB`)
    const all = await env.store.all('files')
    const used = all.reduce((n, f) => n + f.data.byteLength, 0)
    if (used + data.byteLength > LIMITS.total || all.length >= LIMITS.files) return fail(507, 'The saves here are full until the next fresh start')
    const key = `${d}/${name}`
    const before = all.find((f) => f.key === key)
    if (before && (await sha1(before.data)) !== (await sha1(data))) await keepVersion(env, before, 'game')
    const mtime = Number(req.headers.get('x-mtime')) || Date.now()
    await env.store.put('files', { key, dir: d, name, data, mtime } satisfies FileRow)
    env.notify()
    return json({ ok: true, size: data.byteLength, mtime, sha1: await sha1(data) })
  }
  if (rest === '/file' && method === 'DELETE') {
    const { dir: d, name } = resolve()
    const row = await env.store.get('files', `${d}/${name}`)
    if (row) {
      await keepVersion(env, row, 'game-delete')
      await env.store.del('files', row.key)
      env.notify()
    }
    return json({ ok: true })
  }
  if (rest === '/save-dir' && method === 'POST') return json({ ok: true, changed: false, saveDir: dir })
  if (rest === '/slot' && method === 'DELETE') {
    const row = await rowAt(cleanRel(url.searchParams.get('file')))
    if (!row) return fail(404, 'Save not found')
    await keepVersion(env, row, 'user-delete')
    await env.store.del('files', row.key)
    await env.store.del('notes', row.key)
    env.notify()
    return json({ ok: true })
  }
  if (rest === '/meta' && method === 'PUT') {
    const file = cleanRel(url.searchParams.get('file'))
    if (!dir || !isSlotFile(file)) return fail(400, 'Choose a save file')
    return setNote(env, dir, file, (await req.json().catch(() => ({}))) as { title?: unknown; note?: unknown; pinned?: unknown })
  }
  if (rest === '/screenshot' && method === 'GET') {
    const row = await rowAt(cleanRel(url.searchParams.get('file')))
    const png = row ? (await readSave(row.data, true))?.screenshot : null
    return png ? new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } }) : fail(404, 'No screenshot')
  }
  if (rest === '/download' && method === 'GET') {
    const file = cleanRel(url.searchParams.get('file'))
    const row = await rowAt(file)
    return row ? new Response(row.data, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${file.split('/').pop()}"` } }) : fail(404, 'Not found')
  }
  if (rest === '/history' && method === 'GET') {
    const name = url.searchParams.get('file')
    const versions = (await env.store.all('versions')).filter((v) => v.dir === dir && (!name || v.name === name)).sort((a, b) => b.savedAt - a.savedAt)
    return json({ versions: versions.map((v) => ({ id: v.id, name: v.name, size: v.data.byteLength, savedAt: v.savedAt, reason: v.reason })) } satisfies SaveVersions)
  }
  if (rest === '/history/restore' && method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { id?: unknown }
    if (typeof body.id !== 'string') return fail(400, 'Missing version id')
    const version = await env.store.get('versions', body.id)
    if (!version) return fail(404, 'Version not found')
    const now = await env.store.get('files', version.key)
    if (now) await keepVersion(env, now, 'restore')
    const mtime = Date.now()
    await env.store.put('files', { key: version.key, dir: version.dir, name: version.name, data: version.data, mtime } satisfies FileRow)
    env.notify()
    return json({ ok: true, file: { name: version.name, size: version.data.byteLength, mtimeMs: mtime, outcome: now ? 'replaced' : 'added' } })
  }
  return null
}
