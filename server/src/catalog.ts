import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from './config.js'
import { parseJson, type Db, type GameSource } from './db.js'
import type { JobContext } from './jobs.js'
import { exists, writeFileAtomic } from './util/fsx.js'
import { cleanRelPath, isSlug } from './util/paths.js'

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
const COVERS_KEY = 'catalog_covers'
const MAX_AGE = 6 * 3600_000
const MAX_COVER = 4 << 20

interface CoverFile {
  url: string
  file: string
  etag: string
}

/** File extension for an image's bytes, or null if it is not a WebP, PNG or JPEG. */
function imageExt(b: Buffer): string | null {
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  if (b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg'
  return null
}

function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
  return re.test(name)
}

function valid(g: any): g is Recipe {
  return g && typeof g.id === 'string' && typeof g.title === 'string' && Array.isArray(g.releases)
}

export class Catalog {
  private recipes = new Map<string, Recipe>()
  private covers = new Map<string, string>()
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
    this.covers = new Map(Object.entries(this.db.getSetting<Record<string, CoverFile>>(COVERS_KEY, {})).map(([id, c]) => [id, c.file]))
    this.link()
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
      this.link()
      await this.syncCovers()
    }
    return { games: this.recipes.size, errors: this.errors }
  }

  /**
   * Links installed games to their recipe: by the game's id, its archive
   * (checksum, name or pattern) or its save folder. Games installed before
   * their recipe existed pick it up this way without a reinstall.
   */
  link(): void {
    for (const g of this.db.allGames()) {
      if (g.recipe_id) continue
      const source = parseJson<GameSource>(g.source, {})
      const recipe =
        this.recipes.get(g.id) ??
        (source.archive ? this.match({ name: source.archive, size: source.size, sha256: source.sha256 })?.recipe : undefined) ??
        (g.save_dir ? [...this.recipes.values()].find((r) => r.saveDir === g.save_dir) : undefined)
      if (recipe) this.db.updateGame(g.id, { recipe_id: recipe.id })
    }
  }

  /**
   * Downloads the recipes' covers into the covers folder (named by content, so
   * they can be cached forever) and removes every other file there.
   */
  private async syncCovers(): Promise<void> {
    const dir = this.cfg.coversDir
    const known = this.db.getSetting<Record<string, CoverFile>>(COVERS_KEY, {})
    const next: Record<string, CoverFile> = {}
    await mkdir(dir, { recursive: true })
    for (const r of this.recipes.values()) {
      if (!r.cover || !isSlug(r.id)) continue
      const have = known[r.id]
      let url = ''
      try {
        url = new URL(r.cover, r._base ?? this.cfg.catalogUrls[0]).toString()
        if (!/^https?:/.test(url)) throw new Error('not an http(s) URL')
        const cached = have?.url === url && (await exists(join(dir, have.file)))
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: cached && have.etag ? { 'if-none-match': have.etag } : {} })
        if (res.status === 304 && cached) {
          next[r.id] = have
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = Buffer.from(await res.arrayBuffer())
        const ext = imageExt(data)
        if (!ext || data.length > MAX_COVER) throw new Error('not a WebP, PNG or JPEG image under 4 MB')
        const file = `${r.id}.${createHash('sha256').update(data).digest('hex').slice(0, 12)}.${ext}`
        if (!(await exists(join(dir, file)))) await writeFileAtomic(join(dir, file), data)
        next[r.id] = { url, file, etag: res.headers.get('etag') ?? '' }
      } catch (e) {
        if (have) next[r.id] = have
        this.errors.push(`cover of ${r.id} (${url || r.cover}): ${(e as Error).message}`)
      }
    }
    this.db.setSetting(COVERS_KEY, next)
    this.covers = new Map(Object.entries(next).map(([id, c]) => [id, c.file]))
    const keep = new Set(this.covers.values())
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      if (!keep.has(f)) await rm(join(dir, f), { recursive: true, force: true }).catch(() => {})
    }
  }

  /** URL of a recipe's cover, once downloaded. */
  cover(id: string): string | null {
    const file = this.covers.get(id)
    return file ? `/api/covers/${file}` : null
  }

  /** The newest working release after the installed version, if the catalog lists one. */
  update(recipe: Recipe, version: string): RecipeRelease | null {
    const i = recipe.releases.findIndex((r) => r.version === version)
    if (i <= 0) return null
    return recipe.releases.slice(0, i).find((r) => r.status === 'verified' || r.status === 'playable') ?? null
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
