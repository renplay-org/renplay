import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { JobContext } from './jobs.js'
import { writeFileAtomic } from './util/fsx.js'
import { cleanRelPath, safeJoin } from './util/paths.js'

export interface RecipeArchive {
  name: string
  size?: number
  sha256?: string
  /** Glob-ish pattern (with `*`) used when the exact archive is unknown. */
  pattern?: string
  platform?: string
}

export interface RecipePatch {
  /** Destination inside the project, e.g. "game/zz_renplay_web_fixes.rpy". */
  path: string
  /** URL relative to the catalog index, or absolute. */
  url: string
  sha256: string
}

export interface RecipeRelease {
  version: string
  date?: string
  renpy?: string
  archives: RecipeArchive[]
  status: 'verified' | 'playable' | 'broken' | 'untested'
  verified?: { date: string; renplay?: string; sdk?: string; notes?: string }
}

export interface Recipe {
  id: string
  title: string
  developer?: string
  description?: string
  tags?: string[]
  nsfw?: boolean
  cover?: string
  links?: Record<string, string>
  saveDir?: string
  releases: RecipeRelease[]
  build?: {
    optimizeImages?: boolean
    imageQuality?: number
    progressiveRules?: string
    patches?: RecipePatch[]
  }
  notes?: string
  /** Base URL the recipe was loaded from (for relative patch URLs). */
  _base?: string
}

export interface CatalogIndex {
  schema: number
  generated?: string
  games: Recipe[]
}

const CACHE_KEY = 'catalog_cache'
const MAX_AGE = 6 * 3600_000

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
      await this.loadBundled()
    }
    if (Date.now() - this.fetchedAt > MAX_AGE) void this.refresh().catch(() => {})
  }

  private async loadBundled(): Promise<void> {
    try {
      const here = dirname(fileURLToPath(import.meta.url))
      const raw = await readFile(join(here, '..', 'catalog.json'), 'utf-8')
      this.load((JSON.parse(raw) as CatalogIndex).games ?? [])
    } catch {}
  }

  private load(games: Recipe[]): void {
    this.recipes.clear()
    for (const g of games) if (g && typeof g.id === 'string' && Array.isArray(g.releases)) this.recipes.set(g.id, g)
  }

  async refresh(): Promise<{ games: number; errors: string[] }> {
    const all: Recipe[] = []
    this.errors = []
    for (const url of this.cfg.catalogUrls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const idx = (await res.json()) as CatalogIndex
        for (const g of idx.games ?? []) all.push({ ...g, _base: url })
      } catch (e) {
        this.errors.push(`${url}: ${(e as Error).message}`)
      }
    }
    if (all.length) {
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

  /** Finds the recipe and release an archive belongs to. */
  match(archive: { name: string; size?: number; sha256?: string }): { recipe: Recipe; release: RecipeRelease; exact: boolean } | null {
    const base = archive.name.split('/').pop() ?? archive.name
    let loose: { recipe: Recipe; release: RecipeRelease; exact: boolean } | null = null
    for (const recipe of this.recipes.values()) {
      for (const release of recipe.releases) {
        for (const a of release.archives ?? []) {
          if (archive.sha256 && a.sha256 && a.sha256.toLowerCase() === archive.sha256.toLowerCase()) return { recipe, release, exact: true }
          if (a.name === base && (!a.size || !archive.size || a.size === archive.size)) loose ??= { recipe, release, exact: !!(a.size && archive.size) }
          if (a.pattern && globMatch(a.pattern, base)) loose ??= { recipe, release, exact: false }
        }
      }
    }
    return loose
  }

  async applyPatches(recipe: Recipe, projectDir: string, ctx: JobContext): Promise<void> {
    for (const p of recipe.build?.patches ?? []) {
      const rel = cleanRelPath(p.path)
      if (!rel.startsWith('game/')) throw new Error(`Recipe patch outside game/: ${rel}`)
      const url = new URL(p.url, recipe._base ?? this.cfg.catalogUrls[0]).toString()
      const res = await fetch(url, { signal: ctx.signal })
      if (!res.ok) throw new Error(`Recipe patch download failed: ${url} (${res.status})`)
      const data = Buffer.from(await res.arrayBuffer())
      const digest = createHash('sha256').update(data).digest('hex')
      if (digest !== p.sha256.toLowerCase()) throw new Error(`Recipe patch checksum mismatch: ${rel}`)
      await writeFileAtomic(safeJoin(projectDir, rel), data)
      ctx.log(`Applied recipe patch ${rel}`)
    }
  }
}

function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
  return re.test(name)
}
