import type { JobContext } from '../jobs.js'
import { Limiter } from '../util/limit.js'
import { readAll, type ArchiveSource } from './archive.js'
import { isOptimizableImage, transcodeImage, type ImagePolicy } from './optimize.js'
import type { PackWriter } from './pack.js'

const SKIP = [/(^|\/)\.ds_store$/i, /(^|\/)thumbs\.db$/i, /(^|\/)desktop\.ini$/i, /\.(exe|dll|so|dylib|pdb)$/i, /(^|\/)__MACOSX\//]

export interface HtmlStats {
  files: number
  bytes: number
  imagesConverted: number
  imageBytesBefore: number
  imageBytesAfter: number
}

/**
 * Builds an HTML game (a Twine story, RPG Maker MV/MZ…): every file of its
 * folder goes into the build's pack under its own path, and PNG and JPEG
 * images become WebP under the same names, which browsers show the same.
 * The page loads everything itself, so it all streams.
 */
export async function extractHtml(
  src: ArchiveSource,
  root: string,
  pack: PackWriter,
  policy: ImagePolicy,
  concurrency: number,
  ctx: JobContext,
  isExcluded: (rel: string) => boolean = () => false,
): Promise<HtmlStats> {
  const stats: HtmlStats = { files: 0, bytes: 0, imagesConverted: 0, imageBytesBefore: 0, imageBytesAfter: 0 }
  const entries = src.entries.filter((e) => e.path.startsWith(root) && !e.path.endsWith('/') && !SKIP.some((r) => r.test(e.path)) && !isExcluded(e.path.slice(root.length)))
  const total = entries.reduce((n, e) => n + e.size, 0)
  const limiter = new Limiter(concurrency)
  let done = 0
  let reported = Date.now()
  const tick = (n: number) => {
    done += n
    ctx.progress('Unpacking game files', total ? done / total : 0)
    if (Date.now() - reported > 30_000) {
      reported = Date.now()
      ctx.log(`Unpacking: ${total ? Math.floor((100 * done) / total) : 0}% (${(done / 1e9).toFixed(2)} of ${(total / 1e9).toFixed(2)} GB read), ${stats.files.toLocaleString('en-US')} files written, ${stats.imagesConverted.toLocaleString('en-US')} images converted`)
    }
  }

  for (const e of entries) {
    ctx.signal.throwIfAborted()
    const rel = e.path.slice(root.length)
    if (policy.enabled && isOptimizableImage(rel) && e.size < 256 << 20) {
      const data = await readAll(await e.open(), 256 << 20)
      await limiter.run(async () => {
        const r = await transcodeImage(data, rel, policy)
        if (r.changed) {
          stats.imagesConverted++
          stats.imageBytesBefore += data.length
          stats.imageBytesAfter += r.data.length
        }
        await pack.add(rel, r.data)
        stats.files++
        stats.bytes += r.data.length
        tick(e.size)
      })
      continue
    }
    const w = await pack.begin(rel)
    try {
      for await (const c of await e.open()) await w.write(c as Buffer)
    } finally {
      await w.end()
    }
    stats.files++
    stats.bytes += e.size
    tick(e.size)
  }
  await limiter.drain()
  return stats
}

/** A version in an archive name: "College_Daze_-_.510b_-_All_Files.zip" → ".510b", "Game-v1.2.3-pc" → "1.2.3". */
export function versionFromName(name: string): string | undefined {
  return name.replace(/\.(zip|7z|rar|tar(\.\w+)?)$/i, '').match(/(?:^|[ _-])v?(\d+(?:\.\d+)+[a-z]?|\.\d+[a-z]?)(?=$|[ _-])/i)?.[1]
}

/** SugarCube's Story.domId: where a story keeps its saves ("College Daze" → "college-daze"). */
export function storyId(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}
