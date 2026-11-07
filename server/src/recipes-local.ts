import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import sharp from 'sharp'
import YAML from 'yaml'
import type { CatalogImage } from './art.js'
import type { Recipe, Vocabulary } from './catalog.js'
import { MAX_IMAGE_PIXELS } from './pipeline/image-memory.js'
import { cleanRelPath, safeJoin } from './util/paths.js'

/*
 * Your recipes: a folder of recipe files, in the catalog's own format (recipes/<id>.yaml in
 * renplay-org/catalog), read like one more catalog. A recipe here with the id of a catalog recipe
 * takes its place, so one entry can be fixed without a fork. Art and patches may be files in the
 * folder (art: [{ kind: grid, file: art/my-game/grid.png }], patches under patches/<id>/), checked
 * and hashed here as the catalog's build does.
 */

export interface LocalRecipes {
  games: Recipe[]
  /** A file that could not be read, or a part of one that was left out. */
  problems: Array<{ file: string; message: string; recipe?: string }>
}

/** Groups whose tags show as chips in Renplay 2.9 and older (the index's `tags`). */
const CHIP_GROUPS = new Set(['play', 'story'])
const KINDS = new Set(['grid', 'wide', 'hero', 'logo', 'icon'])

export async function readLocalRecipes(dir: string, vocabulary: Vocabulary): Promise<LocalRecipes> {
  const out: LocalRecipes = { games: [], problems: [] }
  const names = await readdir(dir).catch(() => [] as string[])
  for (const file of names.filter((n) => /\.ya?ml$/i.test(n) && !n.startsWith('_') && !n.startsWith('.')).sort()) {
    const problem = (message: string, recipe?: string) => out.problems.push({ file, message, recipe })
    let r: any
    try {
      r = YAML.parse(await readFile(safeJoin(dir, file), 'utf8'))
    } catch (e) {
      problem(`not valid YAML: ${(e as Error).message.split('\n')[0]}`)
      continue
    }
    const id = basename(file, extname(file))
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      problem('not a recipe')
      continue
    }
    if (r.id !== id) {
      problem(`the id must be ${id}, the file's name`)
      continue
    }
    if (typeof r.title !== 'string' || !r.title.trim()) {
      problem('a recipe needs a title', id)
      continue
    }
    if (!Array.isArray(r.releases)) {
      problem('a recipe needs releases, even an empty list', id)
      continue
    }
    const recipe: Recipe = { ...r, engine: typeof r.engine === 'string' ? r.engine : 'renpy', _origin: 'local' }
    // Tags as the catalog's build publishes them: ids, and the chip labels older clients read.
    if (Array.isArray(r.tags)) {
      const ids = r.tags.filter((t: unknown): t is string => typeof t === 'string')
      const unknown = ids.filter((t: string) => !vocabulary[t])
      if (unknown.length) problem(`unknown tags left out: ${unknown.join(', ')}`, id)
      const known = ids.filter((t: string) => vocabulary[t])
      recipe.tagIds = known
      recipe.tags = known.filter((t: string) => CHIP_GROUPS.has(vocabulary[t]!.group)).map((t: string) => vocabulary[t]!.label.toLowerCase())
    }
    // Art: addresses as they are, files in the folder hashed and measured.
    if (Array.isArray(r.art)) {
      const art: CatalogImage[] = []
      for (const a of r.art) {
        if (!a || typeof a !== 'object' || !KINDS.has(a.kind)) {
          problem('a picture without a known kind (grid, wide, hero, logo or icon) was left out', id)
          continue
        }
        if (typeof a.file === 'string') {
          try {
            const rel = cleanRelPath(a.file)
            const data = await readFile(safeJoin(dir, rel))
            const meta = await sharp(data, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS }).metadata()
            if (!meta.width || !meta.height) throw new Error('not a picture')
            const { file: _f, ...rest } = a
            art.push({ ...rest, url: `local:${rel}`, source: a.source ?? 'developer', sha256: createHash('sha256').update(data).digest('hex'), width: meta.width, height: meta.height })
          } catch (e) {
            problem(`picture ${a.file} left out: ${(e as Error).message}`, id)
          }
        } else if (typeof a.url === 'string' && /^https?:\/\//.test(a.url)) art.push({ source: 'developer', ...a })
        else problem('a picture needs a file in this folder or an http(s) url', id)
      }
      recipe.art = art
    }
    // Patches: files under patches/<id>/, as in the catalog.
    if (Array.isArray(r.build?.patches)) {
      const patches = []
      for (const p of r.build.patches) {
        try {
          if (typeof p?.path !== 'string' || typeof p?.file !== 'string') throw new Error('a patch needs a path and a file')
          const rel = cleanRelPath(`patches/${id}/${p.file}`)
          const data = await readFile(safeJoin(dir, rel))
          patches.push({ path: p.path, url: `local:${rel}`, sha256: createHash('sha256').update(data).digest('hex') })
        } catch (e) {
          problem(`patch left out: ${(e as Error).message}`, id)
        }
      }
      recipe.build = { ...r.build, patches }
    }
    out.games.push(recipe)
  }
  return out
}

/** Reads a file a local recipe names (`local:<path in the folder>`). */
export function readLocalFile(dir: string, url: string): Promise<Buffer> {
  return readFile(safeJoin(dir, cleanRelPath(url.slice('local:'.length))))
}
