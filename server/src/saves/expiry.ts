import { log } from '../util/log.js'
import { bytes } from '../shared/format.js'
import type { SaveStores } from './stores.js'

const DAY = 24 * 3600_000

/** Once a day, deletes for good all the History of a folder whose saves an admin deleted, once its 30 days are over. */
export class SavesExpiry {
  private timers: NodeJS.Timeout[] = []

  constructor(
    private readonly saveStores: SaveStores,
    private readonly libraryDirs: () => Set<string>,
  ) {}

  start(): void {
    const run = () => void this.sweep().catch((e) => log('saves', `Could not delete the History of removed games' saves: ${(e as Error).message}`, 'warn'))
    this.timers = [setTimeout(run, 5 * 60_000), setInterval(run, DAY)]
    for (const t of this.timers) t.unref()
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  async sweep(): Promise<Array<{ folder: string; files: number; bytes: number }>> {
    const swept = await this.saveStores.expireDeleted(this.libraryDirs())
    for (const s of swept) log('saves', `Deleted the History of the saves of ${s.folder} for good: ${s.files} ${s.files === 1 ? 'file' : 'files'}, ${bytes(s.bytes)} freed`)
    return swept
  }
}
