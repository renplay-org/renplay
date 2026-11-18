import { bytes, lowSpace } from '../shared/format.js'
import { log } from '../util/log.js'
import type { DiskSpace } from '../util/disk.js'

const DAY = 24 * 3600_000

/** Says in the log, once a day, that the disk holding the data folder is nearly full. */
export class LowSpaceWatch {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly dataDir: string,
    private readonly space: (path: string) => Promise<DiskSpace | null>,
  ) {}

  start(): void {
    setTimeout(() => void this.check(), 60_000).unref()
    this.timer = setInterval(() => void this.check(), DAY)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  private async check(): Promise<void> {
    const disk = await this.space(this.dataDir)
    if (!disk || !lowSpace(disk)) return
    log('disk', `The disk with the data folder ${this.dataDir} is nearly full: ${bytes(disk.free)} free of ${bytes(disk.total)}. Free space, or move Renplay's data to a bigger disk. Saves, the library database and backups need room to be written.`, 'warn')
  }
}
