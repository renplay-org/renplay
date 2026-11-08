import sharp from 'sharp'
import { rgbaToThumbHash } from 'thumbhash'
import { readSaveMeta, readSaveScreenshot } from './savefile.js'
import type { SaveStore } from './store.js'

/** Metadata cache shared with the library, keyed by store/dir/name/mtime/size. */
const metaCache = new Map<string, Awaited<ReturnType<typeof readSaveMeta>>>()

export async function cachedSaveMeta(store: SaveStore, dir: string, file: { name: string; mtimeMs: number; size: number }) {
  const key = `${store.root}/${dir}/${file.name}/${file.mtimeMs}/${file.size}`
  let meta = metaCache.get(key)
  if (meta === undefined) {
    meta = await readSaveMeta(await store.read(dir, file.name))
    metaCache.set(key, meta)
    if (metaCache.size > 5000) metaCache.delete(metaCache.keys().next().value!)
  }
  return meta
}

/** Scene hashes (thumbhash) of save pictures, keyed like the metadata. */
const hashCache = new Map<string, string | null>()

/**
 * A save picture as a thumbhash: a few dozen bytes that draw only a soft blur of its colours. Sent at
 * the Blurred level instead of the picture, the way art below Shown carries only its hash.
 */
export async function cachedSceneHash(store: SaveStore, dir: string, file: { name: string; mtimeMs: number; size: number }): Promise<string | null> {
  const key = `${store.root}/${dir}/${file.name}/${file.mtimeMs}/${file.size}`
  let hash = hashCache.get(key)
  if (hash === undefined) {
    hash = null
    try {
      const png = await readSaveScreenshot(await store.read(dir, file.name))
      if (png) {
        const { data, info } = await sharp(png).resize(100, 100, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        hash = Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64')
      }
    } catch {}
    hashCache.set(key, hash)
    if (hashCache.size > 5000) hashCache.delete(hashCache.keys().next().value!)
  }
  return hash
}
