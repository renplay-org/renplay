import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from '../config.js'
import { isWebGame, type Db } from '../db.js'
import { presence, walkFiles, writeFileAtomic } from '../util/fsx.js'
import { isSlug, slugify } from '../util/paths.js'
import type { Purger } from '../util/purge.js'

/**
 * Builds live in /games/<game>/<build>/ and never change once written:
 *   game.zip     Ren'Py package + non-streamed game files + placeholders
 *   game/...     streamed images, music, voice and video
 *   cache/...    Python bytecode caches uploaded by the first browser run
 *   build.json   this BuildInfo
 * A mod build, <build>.m<hash>/, holds only its own game.zip, build.json and
 * cache; nginx serves every other file from the base build.
 */
export interface BuildInfo {
  schema: 1
  game: string
  build: string
  /** Base build of a mod build. */
  base?: string
  engine: string
  renpyVersion?: string
  /** Other engines (docs.renplay.org/engines): family, what made it, and the page the game starts from. */
  family?: string
  engineLabel?: string
  entry?: string
  title?: string
  version?: string
  saveDir?: string
  screen?: [number, number]
  createdAt: string
  images?: { converted: number; before: number; after: number }
  streamed?: { files: number; bytes: number }
  zipBytes?: number
  mods?: { hash: string; files: number } | null
}

/** A build's folder name: its base, then `.m<hash>` for the build with the mods applied. */
export const BUILD_RE = /^([a-z0-9]+)(?:\.m([a-z0-9]+))?$/

export function newBuildId(): string {
  return Date.now().toString(36)
}

export function baseOf(build: string): string {
  return BUILD_RE.exec(build)?.[1] ?? build
}

/** The folder name of a base build with the mods of this hash applied. */
export function modBuild(base: string, hash: string): string {
  return `${base}.m${hash}`
}

/** Whether a build has mods applied. */
export function isModBuild(build: string): boolean {
  return build !== baseOf(build)
}

/** Whether a build is the one with the mods of this hash applied. */
export function isModBuildOf(build: string, hash: string): boolean {
  return build === modBuild(baseOf(build), hash)
}

export class Builds {
  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
    private readonly purger: Purger,
  ) {}

  gameDir(id: string): string {
    return join(this.cfg.gamesDir, id)
  }

  dir(id: string, build: string): string {
    return join(this.cfg.gamesDir, id, build)
  }

  async info(id: string, build: string): Promise<BuildInfo | null> {
    try {
      return JSON.parse(await readFile(join(this.dir(id, build), 'build.json'), 'utf-8')) as BuildInfo
    } catch {
      return null
    }
  }

  async writeInfo(dir: string, info: BuildInfo): Promise<void> {
    await writeFileAtomic(join(dir, 'build.json'), JSON.stringify(info, null, 1))
  }

  /** Picks a free game id derived from `base` (a recipe id or a title). */
  uniqueId(base: string): string {
    let s = slugify(base)
    if (!isSlug(s)) s = 'game'
    let n = 1
    let id = s
    while (this.db.getGame(id)) id = `${s}-${++n}`
    return id
  }

  /** Caches stored for a build (a mod build adds its own), with versions for cache-busting URLs. */
  async caches(id: string, build: string): Promise<Array<{ name: string; v: string }>> {
    const out = new Map<string, string>()
    for (const b of isModBuild(build) ? [build, baseOf(build)] : [build]) {
      for (const f of await walkFiles(join(this.dir(id, b), 'cache'))) {
        if (out.has(f.rel)) continue
        if (/\.rpyb$/.test(f.rel) || (f.rel.startsWith('rpyc/') && f.rel.endsWith('.rpyc'))) {
          out.set(f.rel, `${f.size.toString(36)}${Math.floor(f.mtimeMs).toString(36)}`)
        }
      }
    }
    return [...out].map(([name, v]) => ({ name, v }))
  }

  /**
   * Removes every build of a game except the current one (and its base), plus
   * the previous base build, which stays a little longer for players that
   * still have it open.
   */
  async prune(id: string, keepPrevious?: string): Promise<void> {
    const game = this.db.getGame(id)
    const keep = new Set<string>()
    if (game?.build) {
      keep.add(game.build)
      keep.add(baseOf(game.build))
    }
    if (keepPrevious) keep.add(keepPrevious)
    let names: string[] = []
    try {
      names = await readdir(this.gameDir(id))
    } catch {
      return
    }
    for (const n of names) if (!keep.has(n)) await this.purger.purge(join(this.gameDir(id), n))
  }

  /** Removes a game's files entirely. */
  async remove(id: string): Promise<void> {
    await this.purger.purge(this.gameDir(id))
  }

  /**
   * Startup check: a game whose build folder is gone is marked not installed. It keeps its build, so
   * it comes back when the folder is there again, as when a network share is mounted after Renplay
   * starts. Only a missing file counts: when it cannot be read at all, nothing changes. Folders of
   * unknown games are reported, never deleted automatically.
   */
  async verify(): Promise<{ missing: string[]; back: string[]; orphans: string[] }> {
    const missing: string[] = [], back: string[] = []
    for (const g of this.db.allGames()) {
      if (g.status === 'installed' && !g.build) {
        this.db.updateGame(g.id, { status: 'not_installed', size_bytes: 0, file_count: 0 })
        missing.push(g.id)
        continue
      }
      // An uninstalled game has no build. One with a build was marked missing here before.
      if (!g.build || (g.status !== 'installed' && g.status !== 'not_installed')) continue
      // Web games of other engines (docs.renplay.org/engines) have no game.zip, only the pack and its index.
      const marker = isWebGame(g) ? 'assets.json' : 'game.zip'
      const there = await presence(join(this.dir(g.id, g.build), marker))
      if (g.status === 'installed' && there === false) {
        this.db.updateGame(g.id, { status: 'not_installed' })
        missing.push(g.id)
      } else if (g.status === 'not_installed' && there === true) {
        this.db.updateGame(g.id, { status: 'installed' })
        back.push(g.id)
      }
    }
    const orphans: string[] = []
    try {
      for (const n of await readdir(this.cfg.gamesDir)) {
        if (n.startsWith('_') || n.startsWith('.')) continue
        if (!this.db.getGame(n)) orphans.push(n)
      }
    } catch {}
    return { missing, back, orphans }
  }
}
