import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { JobContext } from './jobs.js'
import { cleanRelPath } from './util/paths.js'

export interface RecipeArchive {
  name: string
  size?: number
  sha256?: string
  platform?: string
}

export type RecipeStatus = 'verified' | 'playable' | 'broken' | 'untested'

export interface RecipeRelease {
  version: string
  date?: string
  /** Ren'Py version the game was made with. */
  renpy?: string
  /** Engine to build this release with (overrides the recipe's). */
  engine?: string
  status: RecipeStatus
  archives: RecipeArchive[]
  verified?: { date?: string; renplay?: string; browsers?: string[]; notes?: string }
}

export interface RecipePatch {
  /** Destination inside the game, e.g. "game/zz_renplay_fix.rpy". */
  path: string
  /** URL relative to the catalog index, or absolute. */
  url: string
  sha256: string
}

export interface Recipe {
  id: string
  title: string
  developer?: string
  tags?: string[]
  nsfw?: boolean
  cover?: string
  links?: Record<string, string>
  saveDir?: string
  /** Games whose saves this one imports (an earlier season, a prequel). */
  continuesFrom?: string[]
  /** Archive name patterns (with *) that belong to this game, for releases not listed yet. */
  match?: string[]
  engine?: string
  build?: {
    optimizeImages?: boolean
    imageQuality?: number
    /** Files (globs relative to game/) that go into game.zip instead of streaming. */
    keep?: string[]
    /** Files (globs relative to game/) left out of the build entirely. */
    exclude?: string[]
    patches?: RecipePatch[]
  }
  releases: RecipeRelease[]
  /** Index URL the recipe came from (for relative URLs). */
  _base?: string
}

export interface BuildSettings {
  engine?: string
  quality?: number
  optimize?: boolean
  keep?: string[]
  exclude?: string[]
}

export interface RecipeMatch {
  recipe: Recipe
  /** The listed release, or null for a newer, unlisted version matched by pattern. */
  release: RecipeRelease | null
  /** sha256, or name and size, match a listed archive. */
  exact: boolean
}

const CACHE_KEY = 'catalog_cache'
const MAX_AGE = 6 * 3600_000

function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
  return re.test(name)
}

function valid(g: any): g is Recipe {
  return g && typeof g.id === 'string' && typeof g.title === 'string' && Array.isArray(g.releases)
}

export class Catalog {
  private recipes = new Map<string, Recipe>()
  private fetchedAt = 0
  private errors: string[] = []

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
  ) {}

  async init(): Promise<void> {
    const cached = this.db.getSetting<{ at: number; games: Recipe[] } | null>(CACHE_KEY, null)
    if (cached?.games?.length) {
      this.load(cached.games)
      this.fetchedAt = cached.at
    } else {
      try {
        const here = dirname(fileURLToPath(import.meta.url))
        const idx = JSON.parse(await readFile(join(here, '..', 'catalog.json'), 'utf-8'))
        this.load(idx.games ?? [])
      } catch {}
    }
    if (Date.now() - this.fetchedAt > MAX_AGE) void this.refresh().catch(() => {})
  }

  private load(games: unknown[]): void {
    this.recipes.clear()
    for (const g of games) if (valid(g)) this.recipes.set(g.id, g)
  }

  async refresh(): Promise<{ games: number; errors: string[] }> {
    const all: Recipe[] = []
    this.errors = []
    for (const url of this.cfg.catalogUrls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const idx = (await res.json()) as { schema?: number; games?: unknown[] }
        if ((idx.schema ?? 1) < 2) throw new Error(`catalog schema ${idx.schema ?? 1} is too old`)
        for (const g of idx.games ?? []) if (valid(g)) all.push({ ...g, _base: url })
      } catch (e) {
        this.errors.push(`${url}: ${(e as Error).message}`)
      }
    }
    if (all.length || !this.errors.length) {
      this.load(all)
      this.fetchedAt = Date.now()
      this.db.setSetting(CACHE_KEY, { at: this.fetchedAt, games: all })
    }
    return { games: this.recipes.size, errors: this.errors }
  }

  list(): Recipe[] {
    return [...this.recipes.values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  recipe(id: string): Recipe | null {
    return this.recipes.get(id) ?? null
  }

  status(): { fetchedAt: number; urls: string[]; errors: string[]; count: number } {
    return { fetchedAt: this.fetchedAt, urls: this.cfg.catalogUrls, errors: this.errors, count: this.recipes.size }
  }

  /** Finds the recipe (and release) an archive belongs to. */
  match(archive: { name: string; size?: number; sha256?: string }): RecipeMatch | null {
    const base = archive.name.split('/').pop() ?? archive.name
    let byName: RecipeMatch | null = null
    let byPattern: RecipeMatch | null = null
    for (const recipe of this.recipes.values()) {
      for (const release of recipe.releases) {
        for (const a of release.archives ?? []) {
          if (archive.sha256 && a.sha256 && a.sha256.toLowerCase() === archive.sha256.toLowerCase()) return { recipe, release, exact: true }
          if (a.name === base && (!a.size || !archive.size || a.size === archive.size)) {
            byName ??= { recipe, release, exact: !!(a.size && archive.size) }
          }
        }
      }
      if (!byPattern && (recipe.match ?? []).some((p) => globMatch(p, base))) byPattern = { recipe, release: null, exact: false }
    }
    return byName ?? byPattern
  }

  /** Build settings for a recipe, with the engine of the given release. */
  settings(recipe: Recipe, release: RecipeRelease | null): BuildSettings {
    return {
      engine: release?.engine ?? recipe.engine,
      quality: recipe.build?.imageQuality,
      optimize: recipe.build?.optimizeImages,
      keep: recipe.build?.keep ?? [],
      exclude: recipe.build?.exclude ?? [],
    }
  }

  /** Downloads a recipe's patches: path relative to game/ -> content. */
  async patches(recipe: Recipe, ctx: JobContext): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>()
    for (const p of recipe.build?.patches ?? []) {
      const rel = cleanRelPath(p.path)
      if (!rel.startsWith('game/')) throw new Error(`Recipe patch outside game/: ${rel}`)
      const url = new URL(p.url, recipe._base ?? this.cfg.catalogUrls[0]).toString()
      const res = await fetch(url, { signal: ctx.signal })
      if (!res.ok) throw new Error(`Recipe patch download failed: ${url} (${res.status})`)
      const data = Buffer.from(await res.arrayBuffer())
      if (createHash('sha256').update(data).digest('hex') !== p.sha256.toLowerCase()) throw new Error(`Recipe patch checksum mismatch: ${rel}`)
      out.set(rel.slice(5), data)
      ctx.log(`Recipe patch ${rel}`)
    }
    return out
  }
}
