import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import { baseOf, type Builds } from '../builds.js'
import type { Config } from '../config.js'
import type { Db } from '../db.js'
import type { JobContext } from '../jobs/manager.js'
import type { Overlays } from '../mods.js'
import { exists } from '../util/fsx.js'
import { readAll, openZip } from './archive.js'
import { copyZipEntries } from './assemble.js'
import { PackReader } from './pack.js'

const STORED = /\.(png|jpe?g|webp|avif|gif|ogg|opus|mp3|webm|mp4|ogv|zip|rpa|rpyc|rpymc|rpyb)$/i

export interface ModDeps {
  cfg: Config
  db: Db
  builds: Builds
  overlays: Overlays
}

/**
 * Applies a game's mod overlay as a mod build, <base>.m<hash>/, holding only a
 * new game.zip: the base game.zip with modded files swapped in (removed from
 * the streaming list, so Ren'Py takes them from the zip) and hidden files
 * dropped. Every other file is still served from the base build. Changed
 * scripts are compiled by Ren'Py in the browser when the game starts.
 */
export async function applyMods(ctx: JobContext<{ game: string }>, deps: ModDeps): Promise<unknown> {
  const { cfg, db, builds, overlays } = deps
  const id = ctx.params.game
  const game = db.getGame(id)
  if (!game || game.status !== 'installed' || !game.build) throw new Error('Game is not installed')
  const base = baseOf(game.build)
  const baseZip = join(builds.dir(id, base), 'game.zip')
  if (!(await exists(baseZip))) throw new Error('The installed build is missing its game.zip')

  const { files, deleted } = await overlays.list(id)
  if (!files.length && !deleted.length) {
    db.updateGame(id, { build: base })
    await builds.prune(id)
    return { build: base, mods: 0 }
  }

  const hash = await overlays.hash(id)
  const build = `${base}.m${hash}`
  if (game.build === build && (await exists(join(builds.dir(id, build), 'game.zip')))) return { build, mods: files.length + deleted.length, unchanged: true }

  const touched = new Set<string>(files.map((f) => f.path))
  for (const d of deleted) {
    touched.add(d)
    if (d.endsWith('.rpy')) touched.add(d + 'c')
  }

  const tmp = join(cfg.workDir, ctx.id, build)
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  try {
    // Streaming list of the base build, minus everything the mod touches.
    ctx.progress('Reading the installed build')
    let remote = ''
    const src = await openZip(baseZip)
    try {
      const e = src.entries.find((x) => x.path === 'game/renpyweb_remote_files.txt')
      if (e) remote = (await readAll(await e.open(), 64 << 20)).toString('utf-8')
    } finally {
      src.close()
    }
    const lines = remote.split('\n')
    let kept = ''
    for (let i = 0; i + 1 < lines.length; i += 2) if (!touched.has(`game/${lines[i]}`)) kept += `${lines[i]}\n${lines[i + 1]}\n`

    ctx.progress('Packing game.zip')
    const zip = new yazl.ZipFile()
    const done = pipeline(zip.outputStream, createWriteStream(join(tmp, 'game.zip')))
    await copyZipEntries(
      baseZip,
      zip,
      (name) => touched.has(name) || name === 'game/renpyweb_remote_files.txt' || (name.startsWith('_placeholders/') && touched.has(`game/${name.slice(14)}`)),
    )
    for (const f of files) {
      const data = await overlays.read(id, f.path)
      if (data) zip.addBuffer(data, f.path, { compress: !STORED.test(f.path) })
    }
    zip.addBuffer(Buffer.from(kept, 'utf-8'), 'game/renpyweb_remote_files.txt')
    zip.end()
    await done

    const baseInfo = await builds.info(id, base)
    await builds.writeInfo(tmp, {
      ...(baseInfo ?? { schema: 1, game: id, engine: game.engine, createdAt: new Date().toISOString() }),
      schema: 1,
      game: id,
      build,
      base,
      createdAt: new Date().toISOString(),
      mods: { hash, files: files.length + deleted.length },
    })
    await rm(builds.dir(id, build), { recursive: true, force: true })
    await rename(tmp, builds.dir(id, build))
    db.updateGame(id, { build })
    await builds.prune(id)
    ctx.log(`Mod build ${build}: ${files.length} files changed, ${deleted.length} hidden`)
    return { build, mods: files.length + deleted.length }
  } finally {
    await rm(join(cfg.workDir, ctx.id), { recursive: true, force: true }).catch(() => {})
  }
}

/** The streamed assets of a build (mod builds use their base build's). */
export function assetsOf(builds: Builds, id: string, build: string): PackReader {
  const dir = builds.dir(id, baseOf(build))
  return new PackReader(join(dir, 'assets.pack'), join(dir, 'assets.json'))
}

/** Files of the base build a player can browse in the mod editor. */
export async function baseFiles(builds: Builds, id: string, build: string): Promise<Map<string, { size: number; where: 'zip' | 'pack' }>> {
  const out = new Map<string, { size: number; where: 'zip' | 'pack' }>()
  const src = await openZip(join(builds.dir(id, baseOf(build)), 'game.zip'))
  try {
    for (const e of src.entries) {
      if (e.path.startsWith('game/') && e.path !== 'game/renpyweb_remote_files.txt') out.set(e.path, { size: e.size, where: 'zip' })
    }
  } finally {
    src.close()
  }
  for (const [rel, [, size]] of await assetsOf(builds, id, build).index()) out.set(`game/${rel}`, { size, where: 'pack' })
  return out
}

export async function readBaseFile(builds: Builds, id: string, build: string, path: string): Promise<Buffer | null> {
  if (path.startsWith('game/')) {
    const data = await assetsOf(builds, id, build).read(path.slice(5))
    if (data) return data
  }
  const src = await openZip(join(builds.dir(id, baseOf(build)), 'game.zip'))
  try {
    const e = src.entries.find((x) => x.path === path)
    return e ? await readAll(await e.open(), 256 << 20) : null
  } finally {
    src.close()
  }
}
