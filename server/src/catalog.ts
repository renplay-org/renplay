import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Config } from './config.js'
import { ContentMode, sfwIndexUrl } from './content.js'
import { parseJson, type Db, type GameSource } from './db.js'
import type { JobContext } from './jobs.js'
import sharp from 'sharp'
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
  /** Version of the engine the game was made with (Ren'Py 8.2.1, Godot 4.6.2). */
  madeWith?: string
  /** Web runtime to build this release with (overrides the recipe's). */
  runtime?: string
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

export type GameState = 'ongoing' | 'completed' | 'on-hold' | 'abandoned'
export type Vocabulary = Record<string, { label: string; group: 'play' | 'story' | 'art' | 'protagonist' | 'content' }>

/** Archive names identify releases even when the game's internal version is unrelated. */
export function installedRelease(recipe: Recipe, version: string, archive?: string): RecipeRelease | null {
  const name = archive?.split('/').pop()
  return (name ? recipe.releases.find((r) => r.archives?.some((a) => a.name === name)) : undefined)
    ?? recipe.releases.find((r) => r.version === version) ?? null
}

export interface Recipe {
  id: string
  title: string
  developer?: string
  tags?: string[]
  tagIds?: string[]
  content?: string[]
  state?: GameState
  summary?: string
  nsfw?: boolean
  free?: boolean
  /**
   * The game's official cover art: a file in the catalog (safe for work only)
   * or a URL on the developer's own hosting. The published index gives an
   * object with the image's sha256 and size.
   */
  cover?: string | RecipeCover
  links?: Record<string, string>
  saveDir?: string
  /** Games whose saves this one imports (an earlier season, a prequel). */
  continuesFrom?: string[]
  /** Archive name patterns (with *) that belong to this game, for releases not listed yet. */
  match?: string[]
  /** What made the game. Ren'Py is what Renplay is for (docs.renplay.org/engines). */
  engine: 'renpy' | 'html' | 'godot' | 'unity'
  /** Web runtime to build with, from renplay-org/engines; default the newest that fits. */
  runtime?: string
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

export interface RecipeCover {
  sfw?: boolean
  url: string
  sha256?: string
  width?: number
  height?: number
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
/** What blocking needs to know about adult recipes: ids, archives and save folders, never titles, tags or covers. */
const STUBS_KEY = 'catalog_adult_stubs'
/** How often the catalog is fetched while Renplay runs (cheap: covers are fetched only when changed). */
const REFRESH_EVERY = 3600_000
const MAX_COVER = 16 << 20
/** Covers are shown as thumbnails; wider art is scaled down to this. */
const COVER_WIDTH = 960

interface CoverFile {
  url: string
  /** sha256 of the downloaded original, to notice when it changes. */
  sha256: string
  file: string
  etag: string
}

function isImage(b: Buffer): boolean {
  const head = b.subarray(0, 12).toString('latin1')
  return (head.startsWith('RIFF') && head.slice(8) === 'WEBP') || head.startsWith('\x89PNG') || (b[0] === 0xff && b[1] === 0xd8) || head.startsWith('GIF8')
}

function globMatch(pattern: string, name: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
  return re.test(name)
}

function valid(g: any): g is Recipe {
  return g && typeof g.id === 'string' && typeof g.title === 'string' && Array.isArray(g.releases)
}

/**
 * Recipes in catalog schema 3 names. Schema 2 (and caches written by Renplay
 * 2.5 and older) called the runtime `engine` and a release's madeWith and
 * runtime `renpy` and `engine`; all of those were Ren'Py games.
 */
export function normalizeRecipe(g: any): Recipe {
  const old = typeof g.engine !== 'string' || /^\d/.test(g.engine)
  const { renpy: _r, engine: _e, ...rest } = g
  return {
    ...rest,
    engine: old ? 'renpy' : g.engine,
    runtime: g.runtime ?? (old ? g.engine : undefined),
    releases: g.releases.map(({ renpy, engine, ...r }: any) => ({ ...r, madeWith: r.madeWith ?? renpy, runtime: r.runtime ?? engine })),
  }
}

/** An adult recipe reduced to what recognizes its archives and save folder. */
function stub(r: Recipe): Recipe {
  return {
    id: r.id,
    title: '',
    nsfw: true,
    engine: r.engine,
    saveDir: r.saveDir,
    match: r.match,
    releases: r.releases.map((x) => ({ version: x.version, status: x.status, archives: (x.archives ?? []).map(({ name, size, sha256 }) => ({ name, size, sha256 })) })),
  }
}

/** The catalog without its adult games: for an index that is not the safe-for-work one. */
function withoutAdult(games: Recipe[], vocabulary: Vocabulary): { games: Recipe[]; adult: Recipe[]; vocabulary: Vocabulary } {
  const hidden = new Set(Object.entries(vocabulary).filter(([, v]) => v.group === 'content').map(([id]) => id))
  const labels = new Set(Object.entries(vocabulary).filter(([, v]) => v.group === 'content').map(([, v]) => v.label))
  const safe = games.filter((g) => g.nsfw !== true).map((g) => ({
    ...g,
    content: [],
    tagIds: g.tagIds?.filter((t) => !hidden.has(t)),
    tags: g.tags?.filter((t) => !labels.has(t)),
  }))
  return {
    games: safe,
    adult: games.filter((g) => g.nsfw === true),
    vocabulary: Object.fromEntries(Object.entries(vocabulary).filter(([id]) => !hidden.has(id))),
  }
}

interface Index {
  schema?: number
  games?: unknown[]
  vocabulary?: Vocabulary
}

async function fetchIndex(url: string): Promise<Index> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const idx = (await res.json()) as Index
  if ((idx.schema ?? 1) < 2) throw new Error(`catalog schema ${idx.schema ?? 1} is too old`)
  return idx
}

export class Catalog {
  private recipes = new Map<string, Recipe>()
  /** Adult recipes of a blocked install, reduced by stub(): enough to refuse their archives and hide their games. */
  private adult = new Map<string, Recipe>()
  vocabulary: Vocabulary = {}
  private covers = new Map<string, string>()
  private fetchedAt = 0
  private errors: string[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
    readonly content: ContentMode = new ContentMode(cfg, db),
  ) {}

  async init(): Promise<void> {
    const cached = this.db.getSetting<{ at: number; games: Recipe[]; vocabulary?: Vocabulary; adultGames?: string } | null>(CACHE_KEY, null)
    this.adult = new Map(Object.entries(this.db.getSetting<Record<string, Recipe>>(STUBS_KEY, {})))
    if (cached && Array.isArray(cached.games)) {
      this.load(cached.games)
      this.vocabulary = cached.vocabulary ?? {}
      // A catalog cached without its adult games is stale once they are allowed.
      this.fetchedAt = !this.content.blocked && cached.adultGames === 'block' ? 0 : cached.at
    } else {
      try {
        const here = dirname(fileURLToPath(import.meta.url))
        const idx = JSON.parse(await readFile(join(here, '..', 'catalog.json'), 'utf-8'))
        this.load(idx.games ?? [])
        this.vocabulary = idx.vocabulary ?? {}
      } catch {}
    }
    this.covers = new Map(Object.entries(this.db.getSetting<Record<string, CoverFile>>(COVERS_KEY, {})).map(([id, c]) => [id, c.file]))
    this.syncAdult()
    if (this.content.blocked) await this.restrict()
    this.link()
    if (Date.now() - this.fetchedAt > REFRESH_EVERY) void this.refresh().catch(() => {})
    this.timer = setInterval(() => void this.refresh().catch(() => {}), REFRESH_EVERY)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private setAdult(recipes: Recipe[]): void {
    this.adult = new Map(recipes.map((r) => [r.id, r.title === '' && r.nsfw ? r : stub(r)]))
    this.db.setSetting(STUBS_KEY, Object.fromEntries(this.adult))
  }

  /**
   * Called after the admin changes the setting. Blocking drops the adult
   * recipes and covers at once and fetches the safe-for-work index; allowing
   * fetches the full one.
   */
  async modeChanged(): Promise<void> {
    if (this.content.blocked) {
      this.syncAdult()
      await this.restrict()
    } else {
      this.syncAdult()
      this.adult = new Map()
      this.db.setSetting(STUBS_KEY, {})
    }
    void this.refresh().catch(() => {})
  }

  /** Moves adult recipes out of the catalog (keeping only a stub) and deletes their covers. */
  private async restrict(): Promise<void> {
    const gone = [...this.recipes.values()].filter((r) => r.nsfw === true)
    if (gone.length) {
      const kept = withoutAdult([...this.recipes.values()], this.vocabulary)
      this.setAdult([...this.adult.values(), ...gone])
      this.load(kept.games)
      this.vocabulary = kept.vocabulary
      this.db.setSetting(CACHE_KEY, { at: this.fetchedAt, games: kept.games, vocabulary: kept.vocabulary, adultGames: 'block' })
    } else {
      const cache = this.db.getSetting<{ at: number; games: Recipe[]; vocabulary?: Vocabulary } | null>(CACHE_KEY, null)
      if (cache) this.db.setSetting(CACHE_KEY, { ...cache, adultGames: 'block' })
    }
    await this.purgeCovers((id) => !this.recipes.has(id))
  }

  /** Forgets covers (and deletes their files) of recipes the catalog no longer has. */
  private async purgeCovers(drop: (id: string) => boolean): Promise<void> {
    const known = this.db.getSetting<Record<string, CoverFile>>(COVERS_KEY, {})
    const next = Object.fromEntries(Object.entries(known).filter(([id]) => !drop(id)))
    this.db.setSetting(COVERS_KEY, next)
    this.covers = new Map(Object.entries(next).map(([id, c]) => [id, c.file]))
    const keep = new Set(this.covers.values())
    for (const f of await readdir(this.cfg.coversDir).catch(() => [] as string[])) {
      if (!keep.has(f)) await rm(join(this.cfg.coversDir, f), { recursive: true, force: true }).catch(() => {})
    }
  }

  /** Remembers which library games have adult recipes, for when the catalog can no longer say. */
  syncAdult(): void {
    for (const g of this.db.allGames()) {
      if (!g.recipe_id) continue
      const adult = this.recipes.has(g.recipe_id) ? (this.recipes.get(g.recipe_id)!.nsfw === true ? 1 : 0) : this.adult.has(g.recipe_id) ? 1 : g.adult
      if (adult !== g.adult) this.db.updateGame(g.id, { adult })
    }
  }

  /** True when this recipe id belongs to an adult game that a blocked install does not show. */
  isAdultId(id: string): boolean {
    return this.adult.has(id) || this.recipes.get(id)?.nsfw === true
  }

  private load(games: unknown[]): void {
    this.recipes.clear()
    for (const g of games) if (valid(g)) this.recipes.set(g.id, normalizeRecipe(g))
  }

  async refresh(): Promise<{ games: number; errors: string[] }> {
    const all: Recipe[] = []
    const vocabulary: Vocabulary = Object.create(null)
    this.errors = []
    const blocked = this.content.blocked
    const adult: Recipe[] = []
    for (const url of this.cfg.catalogUrls) {
      // A blocked install reads the safe-for-work index; where that is missing, the full one with its adult games dropped.
      const sfw = blocked ? sfwIndexUrl(url) : null
      let idx: Index | null = null
      let from = url
      if (sfw) {
        try {
          idx = await fetchIndex(sfw)
          from = sfw
        } catch (e) {
          console.warn(`catalog: no safe-for-work index at ${sfw} (${(e as Error).message}); dropping adult games from ${url}`)
          this.errors.push(`${sfw}: ${(e as Error).message}`)
        }
      } else if (blocked) {
        console.warn(`catalog: ${url} has no safe-for-work index; dropping its adult games`)
      }
      try {
        idx ??= await fetchIndex(url)
        let games: Recipe[] = (idx.games ?? []).filter(valid).map((g) => ({ ...normalizeRecipe(g), _base: from }))
        let vocab = idx.vocabulary ?? {}
        if (blocked) {
          const kept = withoutAdult(games, vocab)
          games = kept.games
          vocab = kept.vocabulary
          adult.push(...kept.adult)
        }
        for (const [id, entry] of Object.entries(vocab)) {
          if (!Object.hasOwn(vocabulary, id)) vocabulary[id] = entry
        }
        all.push(...games)
      } catch (e) {
        this.errors.push(`${url}: ${(e as Error).message}`)
      }
    }
    if (all.length || !this.errors.length) {
      this.load(all)
      this.vocabulary = vocabulary
      this.fetchedAt = Date.now()
      this.setAdult(blocked ? [...this.adult.values(), ...adult] : [])
      this.db.setSetting(CACHE_KEY, { at: this.fetchedAt, games: all, vocabulary, adultGames: this.content.adultGames })
      this.syncAdult()
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
        this.adult.get(g.id) ??
        (source.archive ? this.match({ name: source.archive, size: source.size, sha256: source.sha256 })?.recipe : undefined) ??
        (g.save_dir ? [...this.recipes.values(), ...this.adult.values()].find((r) => r.saveDir === g.save_dir) : undefined)
      if (recipe) this.db.updateGame(g.id, { recipe_id: recipe.id, adult: recipe.nsfw === true ? 1 : g.adult })
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
      const cover: RecipeCover = typeof r.cover === 'string' ? { url: r.cover } : r.cover
      const have = known[r.id]
      let url = ''
      try {
        url = new URL(cover.url, r._base ?? this.cfg.catalogUrls[0]).toString()
        if (!/^https?:/.test(url)) throw new Error('not an http(s) URL')
        const cached = have?.url === url && (!cover.sha256 || have.sha256 === cover.sha256) && (await exists(join(dir, have.file)))
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: cached && have.etag ? { 'if-none-match': have.etag } : {} })
        if (res.status === 304 && cached) {
          next[r.id] = have
          continue
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = Buffer.from(await res.arrayBuffer())
        if (!isImage(data) || data.length > MAX_COVER) throw new Error('not a WebP, PNG, JPEG or GIF image under 16 MB')
        const sha256 = createHash('sha256').update(data).digest('hex')
        if (cover.sha256 && cover.sha256.toLowerCase() !== sha256) throw new Error('the image changed since the catalog checked it')
        if (cached && have.sha256 === sha256) {
          next[r.id] = { ...have, etag: res.headers.get('etag') ?? '' }
          continue
        }
        // Thumbnails: WebP, at most COVER_WIDTH wide, first frame of animations.
        const webp = await sharp(data, { failOn: 'none' }).resize({ width: COVER_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
        const file = `${r.id}.${createHash('sha256').update(webp).digest('hex').slice(0, 12)}.webp`
        if (!(await exists(join(dir, file)))) await writeFileAtomic(join(dir, file), webp)
        next[r.id] = { url, sha256, file, etag: res.headers.get('etag') ?? '' }
      } catch (e) {
        if (have) next[r.id] = have
        this.errors.push(`cover of ${r.id} (${url || cover.url}): ${(e as Error).message}`)
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
  update(recipe: Recipe, version: string, archive?: string): RecipeRelease | null {
    const release = installedRelease(recipe, version, archive)
    const i = release ? recipe.releases.indexOf(release) : -1
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
    for (const recipe of [...this.recipes.values(), ...this.adult.values()]) {
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
      engine: release?.runtime ?? recipe.runtime,
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
