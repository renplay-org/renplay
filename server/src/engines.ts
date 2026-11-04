import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Config } from './config.js'
import type { Db } from './db.js'
import type { JobContext } from './jobs.js'
import { dirSize, exists } from './util/fsx.js'
import { HttpError } from './util/paths.js'
import type { Purger } from './util/purge.js'

export interface EngineFile {
  size: number
  sha256: string
  url: string
}

export interface EngineEntry {
  version: string
  renpy: string
  python: number
  files: Record<string, EngineFile>
}

interface EngineIndex {
  schema: number
  engines: EngineEntry[]
}

/** Files a pack must have; the rest (license) is kept when present. */
const REQUIRED = ['renpy.wasm.gz', 'renpy.data.gz', 'renpy.js', 'renpy-pre.js', 'renpy.zip', 'index.html', 'web-presplash.jpg']
const INDEX_KEY = 'engines_index'
const INDEX_MAX_AGE = 6 * 3600_000
const VERSION_RE = /^\d+\.\d+(\.\d+)*$/

function cmp(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/**
 * Ren'Py web engines, one pack per version from renplay-org/engines. A pack
 * is downloaded the first time a game needs it and removed when no installed
 * game uses it any more.
 */
export class EngineStore {
  private index: { at: number; engines: EngineEntry[] } | null = null
  private ensuring = new Map<string, Promise<string>>()
  private templates = new Map<string, string>()

  constructor(
    private readonly cfg: Config,
    private readonly db: Db,
    private readonly purger: Purger,
  ) {}

  dir(version: string): string {
    if (!VERSION_RE.test(version)) throw new HttpError(400, `Invalid engine version ${version}`)
    return join(this.cfg.enginesDir, version)
  }

  async available(force = false): Promise<EngineEntry[]> {
    this.index ??= this.db.getSetting<{ at: number; engines: EngineEntry[] } | null>(INDEX_KEY, null)
    if (!force && this.index && Date.now() - this.index.at < INDEX_MAX_AGE) return this.index.engines
    try {
      const res = await fetch(this.cfg.enginesUrl, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const idx = (await res.json()) as EngineIndex
      const engines = (idx.engines ?? []).filter((e) => VERSION_RE.test(e.version) && REQUIRED.every((f) => e.files?.[f]?.url))
      this.index = { at: Date.now(), engines }
      this.db.setSetting(INDEX_KEY, this.index)
    } catch (e) {
      if (!this.index) throw new Error(`Cannot load the engine index from ${this.cfg.enginesUrl}: ${(e as Error).message}`)
    }
    return this.index.engines
  }

  async installed(): Promise<Array<{ version: string; bytes: number }>> {
    let names: string[] = []
    try {
      names = await readdir(this.cfg.enginesDir)
    } catch {
      return []
    }
    const out = []
    for (const n of names) {
      if (!VERSION_RE.test(n) || !(await exists(join(this.cfg.enginesDir, n, '.ready')))) continue
      out.push({ version: n, bytes: (await dirSize(join(this.cfg.enginesDir, n))).bytes })
    }
    return out.sort((a, b) => cmp(b.version, a.version))
  }

  /**
   * Picks the engine for a game: an explicit version (recipe or user), the
   * configured default, or the newest engine of the game's Ren'Py major.
   */
  async pick(requested: string | undefined, gameRenpy: string | undefined): Promise<string> {
    const engines = await this.available().catch(() => [] as EngineEntry[])
    const installed = (await this.installed()).map((e) => e.version)
    const known = new Set([...engines.map((e) => e.version), ...installed])
    const want = requested || this.cfg.defaultEngine
    if (want) {
      if (!known.has(want)) throw new Error(`Engine ${want} is not available (have: ${[...known].join(', ') || 'none'})`)
      return want
    }
    // Games made with Ren'Py 7 or older run on the Ren'Py 8 engine: Ren'Py 8
    // loads their scripts, and most of their Python also runs on Python 3.
    const major = Math.max(8, Number((gameRenpy ?? '8').split('.')[0]) || 8)
    const candidates = [...known].filter((v) => Number(v.split('.')[0]) === major).sort(cmp)
    const best = candidates[candidates.length - 1]
    if (!best) throw new Error(`No Ren'Py ${major} engine is available`)
    return best
  }

  async ready(version: string): Promise<boolean> {
    return exists(join(this.dir(version), '.ready'))
  }

  async ensure(version: string, ctx?: JobContext): Promise<string> {
    const dir = this.dir(version)
    if (await this.ready(version)) return dir
    let p = this.ensuring.get(version)
    if (!p) {
      p = this.download(version, ctx).finally(() => this.ensuring.delete(version))
      this.ensuring.set(version, p)
    }
    return p
  }

  private async download(version: string, ctx?: JobContext): Promise<string> {
    const entry = (await this.available()).find((e) => e.version === version)
    if (!entry) throw new Error(`Engine ${version} is not in the engine index`)
    const dir = this.dir(version)
    const tmp = `${dir}.tmp-${Date.now().toString(36)}`
    await mkdir(tmp, { recursive: true })
    try {
      const files = Object.entries(entry.files)
      const total = files.reduce((n, [, f]) => n + f.size, 0)
      let done = 0
      for (const [name, f] of files) {
        if (!/^[A-Za-z0-9._-]+$/.test(name)) continue
        ctx?.log(`Downloading engine ${version}: ${name}`)
        const res = await fetch(f.url, { signal: ctx?.signal, redirect: 'follow' })
        if (!res.ok || !res.body) throw new Error(`Engine download failed: HTTP ${res.status} for ${name}`)
        const hash = createHash('sha256')
        const body = Readable.fromWeb(res.body as any)
        body.on('data', (c: Buffer) => {
          hash.update(c)
          done += c.length
          ctx?.progress(`Downloading Ren'Py ${version} engine`, total ? done / total : 0)
        })
        await pipeline(body, createWriteStream(join(tmp, name)))
        if (hash.digest('hex') !== f.sha256) throw new Error(`Engine file ${name} does not match its checksum`)
      }
      await writeFile(join(tmp, '.ready'), JSON.stringify({ version, renpy: entry.renpy, python: entry.python, at: new Date().toISOString() }))
      await rm(dir, { recursive: true, force: true })
      await rename(tmp, dir)
      ctx?.log(`Engine ${version} (Ren'Py ${entry.renpy}) installed`)
      return dir
    } catch (e) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
      throw e
    }
  }

  /** The engine's page template (index.html of a Ren'Py web build). */
  async template(version: string): Promise<string> {
    let t = this.templates.get(version)
    if (!t) {
      t = await readFile(join(this.dir(version), 'index.html'), 'utf-8')
      this.templates.set(version, t)
    }
    return t
  }

  /** Removes engine packs no installed game uses. */
  async prune(used: Set<string>): Promise<string[]> {
    const removed: string[] = []
    for (const e of await this.installed()) {
      if (used.has(e.version)) continue
      this.templates.delete(e.version)
      await this.purger.purge(this.dir(e.version))
      removed.push(e.version)
    }
    // Leftovers of interrupted downloads.
    try {
      for (const n of await readdir(this.cfg.enginesDir)) {
        if (n.includes('.tmp-') || !VERSION_RE.test(n)) {
          const st = await stat(join(this.cfg.enginesDir, n)).catch(() => null)
          if (st && Date.now() - st.mtimeMs > 3600_000) await this.purger.purge(join(this.cfg.enginesDir, n))
        }
      }
    } catch {}
    return removed
  }
}
