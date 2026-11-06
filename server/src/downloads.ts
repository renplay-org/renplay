import type { Config } from './config.js'
import type { Db } from './db.js'

export function keepDownloads(cfg: Config, db: Db): boolean {
  return cfg.keepDownloadsLocked ? cfg.keepDownloads : db.getSetting('keep_downloads', cfg.keepDownloads)
}
