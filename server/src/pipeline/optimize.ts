import { availableParallelism } from 'node:os'
import sharp from 'sharp'
import { MAX_IMAGE_PIXELS, PixelBudget } from './image-memory.js'
import { makePlaceholder, type Placeholder } from './progressive.js'

sharp.cache(false)
sharp.concurrency(1)

export interface ImagePolicy {
  enabled: boolean
  /** WebP quality for photographic images. */
  quality: number
  effort: number
  /** Keep the original unless the WebP is at least this much smaller (0..1). */
  minSaving: number
}

export const defaultImagePolicy = (quality = 88): ImagePolicy => ({ enabled: true, quality, effort: 4, minSaving: 0.08 })

export function imageConcurrency(configured: number): number {
  return configured > 0 ? configured : Math.max(1, Math.min(16, availableParallelism()))
}

const IMAGE_EXT = /\.(png|jpe?g)$/i

/** Paths (relative to game/) whose images are left untouched. */
function excluded(rel: string): boolean {
  const lower = rel.toLowerCase()
  return (
    lower.startsWith('gui/window_icon') ||
    lower.includes('presplash') ||
    lower.endsWith('.9.png') ||
    lower.startsWith('_placeholders/')
  )
}

export function isOptimizableImage(rel: string): boolean {
  return IMAGE_EXT.test(rel) && !excluded(rel)
}

export interface TranscodeResult {
  data: Buffer
  changed: boolean
}

/** Limits the sum of decoded pixels, not just the number of compressed inputs. */
export class ImageProcessor {
  private budget = new PixelBudget()

  async process(data: Buffer, rel: string, policy: ImagePolicy, placeholder = false): Promise<TranscodeResult & { placeholder: Placeholder | null }> {
    let pixels: number
    try {
      const meta = await sharp(data, { limitInputPixels: MAX_IMAGE_PIXELS, animated: false }).metadata()
      pixels = (meta.width ?? 0) * (meta.height ?? 0)
      if (!pixels || pixels > MAX_IMAGE_PIXELS) return { data, changed: false, placeholder: null }
    } catch {
      return { data, changed: false, placeholder: null }
    }
    return this.budget.run(pixels, async () => {
      const result = await transcodeImage(data, rel, policy)
      return { ...result, placeholder: placeholder ? await makePlaceholder(result.data) : null }
    })
  }
}

/**
 * Re-encodes PNG/JPEG data as WebP while the file keeps its name. Ren'Py's
 * image loader detects the format from the file contents, so scripts that
 * reference "bg.png" keep working.
 */
async function transcodeImage(data: Buffer, rel: string, policy: ImagePolicy): Promise<TranscodeResult> {
  if (!policy.enabled || data.length < 2048 || !isOptimizableImage(rel)) return { data, changed: false }
  // Already WebP (some games ship mislabeled files).
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { data, changed: false }
  }
  try {
    const img = sharp(data, { failOn: 'none', animated: false, limitInputPixels: MAX_IMAGE_PIXELS })
    const meta = await img.metadata()
    if (!meta.width || !meta.height || meta.width > 16383 || meta.height > 16383) return { data, changed: false }
    if ((meta.pages ?? 1) > 1) return { data, changed: false }
    const smallGui = rel.toLowerCase().startsWith('gui/') && meta.width * meta.height <= 512 * 512
    const out = smallGui
      ? await img.webp({ lossless: true, effort: policy.effort }).toBuffer()
      : await img
          .webp({ quality: policy.quality, alphaQuality: 100, effort: policy.effort, smartSubsample: true })
          .toBuffer()
    if (out.length <= data.length * (1 - policy.minSaving)) return { data: out, changed: true }
  } catch {
    // Undecodable input: keep the original bytes.
  }
  return { data, changed: false }
}
