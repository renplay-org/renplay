import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_PIXELS, PixelBudget } from '../pipeline/image-memory.js'
import { ImageProcessor, defaultImagePolicy } from '../pipeline/optimize.js'

describe('image memory', () => {
  it('bounds decoded pixels even when the configured task concurrency is higher', async () => {
    const budget = new PixelBudget(16)
    let pixels = 0
    let peak = 0
    await Promise.all(Array.from({ length: 40 }, (_, i) => {
      const weight = i % 2 ? 8 : 3
      return budget.run(weight, async () => {
        pixels += weight
        peak = Math.max(peak, pixels)
        await new Promise((resolve) => setImmediate(resolve))
        pixels -= weight
      })
    }))
    expect(peak).toBeLessThanOrEqual(16)
    expect(peak).toBeGreaterThan(8)
    expect(pixels).toBe(0)
  })

  it('releases its budget on errors and rejects an oversized task', async () => {
    const budget = new PixelBudget(8)
    await expect(budget.run(8, async () => { throw new Error('encode failed') })).rejects.toThrow('encode failed')
    expect(await budget.run(8, async () => 'next')).toBe('next')
    await expect(budget.run(9, async () => {})).rejects.toThrow('pixel budget')
  })

  it('keeps oversized decoded images intact without decoding them or making a placeholder', async () => {
    const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS)) + 1
    const data = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><rect width="100%" height="100%" fill="red"/></svg>`)
    const result = await new ImageProcessor().process(data, 'large.png', defaultImagePolicy(), true)
    expect(result).toEqual({ data, changed: false, placeholder: null })
  })
})
