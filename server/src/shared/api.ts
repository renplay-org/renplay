// The answers of the server's API, as the library reads them. The server builds each answer with
// these types (`satisfies`), so a change on either side fails the type check of the other.
import type { ArtCredit, ArtFormat, ArtSet } from './art.js'
import type { AdultLevel } from './levels.js'
import type { ArtKind, GameState, Recipe, Vocabulary } from './recipe.js'

/** A person's status with a game. Stalled, Dropped and Finished leave Up next. */
export type PlayStatus = 'playing' | 'stalled' | 'dropped' | 'finished'

/** A catalog source and what it gave the person asking. */
export interface CatalogSource {
  kind: 'catalog' | 'folder'
  location: string
  recipes: number
  pictures: number
  problems: string[]
}

export interface CatalogResponse {
  status: { fetchedAt: number; urls: string[]; errors: string[]; count: number; sources?: CatalogSource[] }
  vocabulary: Vocabulary
  games: CatalogGame[]
}

export interface JobsResponse {
  jobs: Job[]
  busy: boolean
  total: number
}

export interface Game {
  id: string
  title: string
  developer: string | null
  tags: string[]
  tagIds: string[]
  content: string[]
  state: GameState | null
  summary: string | null
  /** The five formats, made by the server from the catalog's pictures and people's choices. */
  art: ArtSet
  /** An adult game, per its recipe. */
  nsfw: boolean
  /** Walkthrough files, in order: PDFs, pictures and plain text. */
  walkthroughs: Array<{ file: string; title: string; kind: 'pdf' | 'image' | 'text'; size: number; addedAt: string; url: string }>
  status: 'installed' | 'not_installed' | 'installing'
  build: string | null
  playUrl: string | null
  /** What made the game: renpy, or another engine (docs.renplay.org/engines). */
  family: string
  /** What made it, for other engines: "HTML (SugarCube 2.36.1)". */
  engineLabel: string | null
  version: string | null
  detectedVersion: string | null
  favoriteAt: string | null
  finishedAt: string | null
  playTime: number
  /** The person's status. Stalled, Dropped and Finished leave Up next. */
  playStatus: PlayStatus | null
  /** The person's rating, 1 to 5. */
  rating: number | null
  /** Not now: out of Up next until it is played again. */
  notNowAt: string | null
  /** How it plays on a phone, curated in the recipe. */
  phone: 'great' | 'playable' | 'desktop' | null
  latestSave: Pick<SaveSlot, 'file' | 'label' | 'name' | 'ctime' | 'runtime' | 'screenshot' | 'screenshotHash'> | null
  free?: boolean
  renpyVersion: string | null
  engine: string | null
  sizeBytes: number
  fileCount: number
  screen: [number, number] | null
  saveDir: string | null
  source: { archive: string | null; size: number | null }
  canReinstall: boolean
  recipe: { id: string; links: Record<string, string>; continuesFrom: string[]; status: string | null } | null
  /** A newer working release listed in the catalog. */
  update: { version: string; date: string | null; status: string; archives?: string[] } | null
  createdAt: string
  installedAt: string | null
  lastPlayedAt: string | null
  saves: { count: number; latest: number }
  mods: { files: number; hash: string; applied: boolean }
  job: { id: string; type: string; status: string; stage: string; progress: number } | null
}

export interface SaveSlot {
  file: string
  size: number
  mtime: number
  kind: 'manual' | 'auto' | 'quick' | 'internal'
  label: string
  page?: string
  slot?: string
  name: string
  ctime: number
  renpyVersion?: string
  gameVersion?: string
  runtime?: number
  screenshot: string | null
  /** At the Blurred level, the picture as a thumbhash instead. */
  screenshotHash?: string | null
  valid: boolean
  /** This person's own name for the save, over the game's. */
  title: string | null
  note: string | null
  /** Pinned: the save keeps every previous version. */
  pinnedAt: string | null
}

export interface SavesResponse {
  saveDir: string | null
  slots: SaveSlot[]
  other: Array<{ name: string; size: number; mtime: number }>
  /** Second versions the conflict rule kept in History during the last two weeks, newest first. */
  conflicts?: Array<{ id: string; file: string; at: number }>
  /** Sync codes are on and this is a Ren'Py game. */
  sync?: boolean
}

export interface Job {
  id: string
  type: string
  game: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
  stage: string
  progress: number
  message: string
  error: string | null
  /** `by`: who started it, for installs since 4.0.2. */
  params: { source?: { kind: string; path?: string }; game?: string; path?: string; by?: number } | null
  result: any
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface Archive {
  path: string
  name: string
  size: number
  mtime: number
  sha256: string | null
  info: ArchiveInfo | null
  installedAs: string | null
  recipe: { id: string; title: string; version: string | null; status: string; exact: boolean; art: ArtSet; nsfw: boolean } | null
  existingGame: string | null
}

/** The installation's adult level, fixed when the server's variable sets it. Admins also get the starting level and the sign-in groups. */
export interface ContentState {
  installation: { level: AdultLevel; fixed: boolean; chosen: boolean; variable: string }
  starting?: { level: AdultLevel; variable: string }
  groups?: {
    oidc: { variable: string; map: Record<string, AdultLevel> } | null
    ldap: { variable: string; map: Record<string, AdultLevel> | null } | null
  }
}

export interface SystemInfo {
  version: string
  /** Ren'Py Sync codes: off until an admin turns them on. */
  sync?: { on: boolean; server: string; chosen?: boolean }
  /** For each variable Settings shows: set on the server, or the default. */
  setBy?: Record<string, 'server' | 'default'>
  /** An admin chose whether downloads are kept (else the default). */
  keepDownloadsChosen?: boolean
  engines: {
    installed: Array<{ version: string; bytes: number; usedBy: string[] }>
    available: Array<{ version: string; renpy: string; bytes: number }>
    index: string
  }
  disk: { games: { total: number; free: number } | null; data: { total: number; free: number } | null }
  library: { games: number; installed: number; bytes: number }
  orphans: string[]
  purging: number
  paths: { games: string; archives: string; data: string }
  keepDownloads: boolean
  keepDownloadsLocked: boolean
  busy: boolean
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  count?: number
  changed?: boolean
  state?: 'base' | 'added' | 'modified' | 'deleted'
  text?: boolean
}

export interface FilesResponse {
  dir: string
  dirs: FileEntry[]
  files: FileEntry[]
  mods: { files: number; deleted: number; hash: string; applied: boolean; job: boolean }
}

/** A catalog recipe as the catalog page reads it: its pictures made, and the library game it is, if any. */
export type CatalogGame = Omit<Recipe, 'art' | '_base' | '_origin'> & {
  art: ArtSet
  local: { id: string; status: string; version: string; detectedVersion: string } | null
  /** From the recipes folder on this server, not the catalog. */
  fromYourRecipes?: boolean
}

export interface ArchiveInfo {
  type: string
  layout: 'project' | 'web' | null
  title?: string
  version?: string
  saveDir?: string
  renpyVersion?: string
  files: number
  /** What made the game (Ren'Py, Twine, Godot…), and whether it installs. */
  engine?: EngineInfo
  /** INSPECT_VERSION of the inspection; older results are inspected again. */
  v?: number
}

/** What made a game. Ren'Py is what Renplay is for, the others are recognized so a download says what it is. */
export type Family = 'renpy' | 'html' | 'godot' | 'unity' | 'rpgmaker-rgss' | 'wolf' | 'kirikiri' | 'unreal' | 'gamemaker' | 'flash'

export interface EngineInfo {
  family: Family
  /** A finer kind within the family: twine-sugarcube, rpgmaker-mz, unity-webgl… */
  kind?: string
  /** The engine's version as the game names it: 2.36.1, 4.6.2, 6000.6.0f1… */
  version?: string
  /**
   * What to show, led by the engine names players know from F95zone (Ren'Py, HTML, RPGM, Unity,
   * Godot): "HTML (SugarCube 2.36.1)", "Godot 4.6.2"…
   */
  label: string
  /** Folder in the archive the game lives in, '' or ending in '/'. */
  root: string
  /** The file it starts from, relative to root (a page, a .pck). */
  entry?: string
  /** Game title found in its files. */
  title?: string
  installable: boolean
  /** Why it cannot be installed, for people. */
  reason?: string
  /** Things that may not work in a browser, for people. */
  warnings: string[]
}

export interface BackupInfo {
  /** Where backups go, or null when they are off. */
  dir: string | null
  keep: number
  files: Array<{ name: string; size: number; at: number }>
  last: number | null
  /** When the next backup is due. Renplay runs it then, or the next time it runs after. */
  next: number | null
  running: boolean
  error: string | null
}

export interface HistorySession {
  game: string
  title: string
  nsfw: boolean
  startedAt: number
  endedAt: number
  seconds: number
  icon: ArtFormat | null
}

export interface HistoryGame {
  id: string
  title: string
  nsfw: boolean
  seconds: number
  sessions: number
  lastPlayedAt: number
  rating: number | null
  playStatus: PlayStatus | null
  icon: ArtFormat | null
}

export interface HistoryPage {
  totals: { seconds: number; sessions: number; games: number; since: number | null }
  days: Array<{ day: string; seconds: number; sessions: HistorySession[] }>
  games: HistoryGame[]
  next: number | null
}

export interface StorageReport {
  games: Array<{ id: string; title: string; status: string; builds: Array<{ name: string; current: boolean; bytes: number }>; download: { name: string; bytes: number } | null; bytes: number }>
  engines: Array<{ version: string; bytes: number; used: boolean }>
  orphans: Array<{ name: string; bytes: number }>
  totals: { builds: number; downloads: number; engines: number }
  freeable: { downloads: number; engines: number }
}

export interface Session { id: string; label: string; created_at: number; touched_at: number; expires_at: number; current: boolean }

export interface Token { id: string; name: string; created_at: number }

export interface Account {
  id: number
  username: string
  name: string
  role: 'admin' | 'player'
  adult_ceiling?: string
  adult_choice?: string
  prefs: string
  avatar?: string
  admin_source?: 'manual' | 'provider' | 'allowlist'
  roleManaged?: boolean
  adultManaged?: boolean
  /** Has a PIN for switching on a shared device. */
  hasPin?: boolean
}

export interface AdultState {
  installation: { level: AdultLevel; fixed: boolean; chosen: boolean }
  ceiling: { level: AdultLevel; managed: 'group' | null }
  choice: AdultLevel
  /** The lowest of installation, ceiling and choice, as the server enforces it. */
  effective: AdultLevel
}

/** What the guided save import compares against: this person's save files by folder, the games, the catalog's save folders. */
export interface SaveImportIndex {
  dirs: Record<string, Record<string, { mtime: number; size: number }>>
  games: Record<string, { id: string; title: string }>
  catalog: Record<string, string>
}

// ---- the server ----------------------------------------------------------------------------

export interface Health {
  ok: true
  uptime: number
  version: string
}

// ---- sign-in and the person's own account ---------------------------------------------------

/** How people sign in here. */
export interface Providers {
  enabled: boolean
  /** The owner account has no sign-in yet and the setup code can give it one. */
  setup: boolean
  /** Passwords: Renplay's own or the directory's. */
  local: boolean
  /** The single sign-on provider's name, or null when it is off. */
  oidc: string | null
  ldap: boolean
  demo: boolean
}

export interface Me {
  user: Account
  /** Sign-in is on. */
  auth: boolean
  /** The demo's shared guest. */
  demo: boolean
  unclaimed: boolean
  hasPassword: boolean
}

/** The ways a person signs in. */
export interface Identities {
  identities: Array<{ provider: string; subject: string; name: string; available: boolean; removable: boolean }>
}

/** The people this browser may switch to by their PIN. */
export interface SwitchPeople {
  people: Array<{ id: number; name: string; avatar: string }>
}

/** The tags a person includes and leaves out on the Catalog page, and whose choice that is. */
export interface TagPrefs {
  include: string[]
  exclude: string[]
  source: 'you' | 'admin' | 'default'
}

export interface Sessions {
  sessions: Session[]
}

export interface Tokens {
  tokens: Token[]
}

/** A new token: its secret is shown this once. */
export interface TokenCreated {
  id: string
  token: string
}

// ---- people ---------------------------------------------------------------------------------

/** A person as the admin's list shows them. */
export type PersonListed = Account & {
  disabled: number
  games: number
  saves: number
  /** The owner or the no-sign-in account: they cannot be removed. */
  protected: boolean
}

export interface People {
  users: PersonListed[]
  adultDefault: AdultLevel
}

// ---- games and their pictures ---------------------------------------------------------------

export interface GamesResponse {
  games: Game[]
}

export interface GameResponse {
  game: Game
}

/** A draft recipe for a library game, as YAML. */
export interface DraftRecipe {
  yaml: string
  /** The download's checksum is still being computed by the job named. */
  sha256Pending: boolean
  hashJob: string | null
}

/** What a browser fetches to keep a game for playing offline. */
export interface OfflineManifest {
  id: string
  build: string
  page: string
  bytes: number
  files: Array<{ url: string; bytes: number }>
}

/** A picture that can fill one format, for the picker. */
export interface ArtCandidate {
  id: string
  current: boolean
  everyone: boolean
  mine: boolean
  inShape: boolean
  width: number
  height: number
  source: string
  credit: ArtCredit
  upload: boolean
  /** Uploaded by this person, and so theirs to delete. */
  ownUpload: boolean
  /** Uploaded for everyone, which an admin may delete. */
  sharedUpload: boolean
  preview: ArtFormat | null
}

export interface ArtCandidates {
  kind: ArtKind
  candidates: ArtCandidate[]
}

/** An upload, made the choice at its scope. A picture smaller than the format carries a warning. */
export interface ArtUploaded {
  id: string
  warning: { width: number; height: number } | null
  art: ArtSet
}

// ---- saves ----------------------------------------------------------------------------------

/** Earlier versions of a save, newest first. */
export interface SaveVersions {
  versions: Array<{ id: string; name: string; size: number; savedAt: number; reason: string }>
}

/** What a sync code brought in. */
export interface SyncDownloaded {
  added: number
  replaced: number
  kept: number
  same: number
}

// ---- adding games ---------------------------------------------------------------------------

export interface ArchivesResponse {
  dir: string
  archives: Archive[]
}

export interface InspectResponse {
  info: ArchiveInfo
  /** The library game installed from this download, if the person may see it. */
  existingGame: string | null
}

/** An upload begun: send its parts, each up to chunkSize. */
export interface UploadStarted {
  id: string
  chunkSize: number
  received: number
}
