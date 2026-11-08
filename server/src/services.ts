import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashArchive } from './archive-origin.js'
import { ArtStore } from './art/store.js'
import { Accounts } from './accounts/accounts.js'
import { SaveBackups } from './saves/backups.js'
import { Builds } from './builds.js'
import { Catalog } from './catalog/catalog.js'
import type { Config } from './config.js'
import { ContentMode } from './content/mode.js'
import { Db } from './db.js'
import { EngineStore } from './engines.js'
import { JobManager } from './jobs/manager.js'
import { ProgressStore } from './progress/store.js'
import { Overlays } from './mods.js'
import { applyMods } from './pipeline/applymods.js'
import { runImport } from './pipeline/import.js'
import type { SaveStore } from './saves/store.js'
import { SaveStores } from './saves/stores.js'
import { Purger } from './util/purge.js'

const here = dirname(fileURLToPath(import.meta.url))

export function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')).version
  } catch {
    return '0.0.0'
  }
}

/**
 * What the server's parts share, made once at start. Every router and job gets it. The signed-in
 * person comes from the request (accounts-context.ts), so `saves` is that person's.
 */
export interface Services {
  cfg: Config
  db: Db
  version: string
  content: ContentMode
  accounts: Accounts
  progress: ProgressStore
  /** The signed-in person's saves. */
  readonly saves: SaveStore
  /** Everyone's saves, with their notes. */
  saveStores: SaveStores
  purger: Purger
  jobs: JobManager
  builds: Builds
  engines: EngineStore
  overlays: Overlays
  art: ArtStore
  catalog: Catalog
  backups: SaveBackups
}

export async function createServices(cfg: Config): Promise<Services> {
  const db = Db.open(cfg.dataDir)
  for (const d of [cfg.dataDir, cfg.walkthroughsDir, cfg.overlaysDir, cfg.internalDir, cfg.workDir, cfg.archivesDir, cfg.uploadsDir, cfg.enginesDir, cfg.purgeDir]) await mkdir(d, { recursive: true })
  // The content mode asks the catalog which save folders are adult; the catalog needs the content mode.
  let catalog: Catalog | null = null
  const content = new ContentMode(cfg, db, () => catalog?.adultSaveDirs() ?? [])
  const progress = new ProgressStore(db)
  const saveStores = new SaveStores(cfg, db)
  const art = new ArtStore(cfg, db, content)
  const accounts = new Accounts(db, cfg, content, saveStores)
  try {
    await accounts.init()
  } catch (error) {
    db.close()
    throw error
  }
  const purger = new Purger(cfg.purgeDir)
  catalog = new Catalog(cfg, db, content, art)
  await catalog.init()
  const s: Services = {
    cfg,
    db,
    version: packageVersion(),
    content,
    accounts,
    progress,
    get saves() {
      return saveStores.of(accounts.current().id)
    },
    purger,
    jobs: new JobManager(db, cfg),
    builds: new Builds(cfg, db, purger),
    engines: new EngineStore(cfg, db, purger),
    overlays: new Overlays(cfg),
    art,
    catalog,
    saveStores,
    backups: new SaveBackups(cfg, db, saveStores),
  }
  s.jobs.register('import', 'Install', (ctx) => runImport(ctx, s))
  s.jobs.register('apply-mods', 'Mod build', (ctx) => applyMods(ctx, s))
  s.jobs.register('hash-archive', 'Checksum', (ctx) => hashArchive(ctx, s))
  return s
}
