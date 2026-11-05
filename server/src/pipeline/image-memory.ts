/** Larger inputs stay byte-for-byte intact and are copied with stream backpressure. */
export const MAX_IMAGE_BYTES = 32 << 20

/** Bounds decoded image memory too: a tiny compressed image can have enormous dimensions. */
export const MAX_IMAGE_PIXELS = 16 * 1024 * 1024

/**
 * Decoded pixels in flight across all image tasks: four 4K images (4 x 8.3 MP) at once, so the
 * default concurrency of 4 keeps all encoders busy on 4K games. With jemalloc (Dockerfile) a
 * 4K-heavy install peaked well under 1 GB at this level of parallelism.
 */
export const IMAGE_PIXEL_BUDGET = 36 * 1024 * 1024

/** FIFO budget. Callers are themselves limited to the configured number of image tasks. */
export class PixelBudget {
  private used = 0
  private waiting: Array<{ pixels: number; resolve: () => void }> = []

  constructor(private readonly capacity = IMAGE_PIXEL_BUDGET) {}

  async run<T>(pixels: number, task: () => Promise<T>): Promise<T> {
    if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > this.capacity) throw new Error('Image exceeds pixel budget')
    await new Promise<void>((resolve) => {
      this.waiting.push({ pixels, resolve })
      this.admit()
    })
    try {
      return await task()
    } finally {
      this.used -= pixels
      this.admit()
    }
  }

  private admit(): void {
    while (this.waiting.length && this.used + this.waiting[0]!.pixels <= this.capacity) {
      const next = this.waiting.shift()!
      this.used += next.pixels
      next.resolve()
    }
  }
}
