import { afterEach, describe, expect, it, vi } from 'vitest'
import { lowSpace } from '../shared/format.js'
import { LowSpaceWatch } from '../system/lowspace.js'

const GB = 1000 ** 3

describe('low disk space', () => {
  afterEach(() => vi.useRealTimers())

  it('is low under 10 percent or under 1 GB free, and not otherwise', () => {
    expect([[100, 9], [5, 0.9], [100, 12], [5, 2], [0, 0]].map(([total, free]) => lowSpace({ total: total! * GB, free: free! * GB }))).toEqual([true, true, false, false, false])
  })

  it('warns in the log once a day while the data folder’s disk is low, and says what to do', async () => {
    vi.useFakeTimers()
    let disk: { total: number; free: number } | null = { total: 5 * GB, free: 0.5 * GB }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const watch = new LowSpaceWatch('/data', async () => disk)
    const warnings = () => log.mock.calls.map((c) => String(c[0])).filter((l) => / warn .*\[disk\]/.test(l))
    watch.start()
    await vi.advanceTimersByTimeAsync(61_000)
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0]).toMatch(/\/data.*500 MB free of 5\.0 GB.*Free space/)
    await vi.advanceTimersByTimeAsync(23 * 3600_000)
    expect(warnings()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2 * 3600_000)
    expect(warnings()).toHaveLength(2)
    // Room again, or a disk that cannot be read: nothing to say.
    disk = { total: 5 * GB, free: 3 * GB }
    await vi.advanceTimersByTimeAsync(24 * 3600_000)
    disk = null
    await vi.advanceTimersByTimeAsync(24 * 3600_000)
    expect(warnings()).toHaveLength(2)
    watch.stop()
  })
})
