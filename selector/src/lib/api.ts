export interface Game {
  id: string
  title: string
  developer: string | null
  tags: string[]
  /** Curated cover from the catalog (URL), or null. */
  cover: string | null
  /** An adult game, per its recipe. */
  nsfw: boolean
  walkthrough: string | null
  status: 'installed' | 'not_installed' | 'installing'
  build: string | null
  playUrl: string | null
  /** What made the game: renpy, or another engine (docs/engines.md). */
  family: string
  /** What made it, for other engines: "SugarCube 2.36.1 (Twine)". */
  engineLabel: string | null
  version: string | null
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
  update: { version: string; date: string | null; status: string } | null
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
  valid: boolean
}

export interface SavesResponse {
  saveDir: string | null
  slots: SaveSlot[]
  other: Array<{ name: string; size: number; mtime: number }>
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
  params: { source?: { kind: string; path?: string }; game?: string; path?: string } | null
  result: any
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface ArchiveInfo {
  type: string
  layout: 'project' | 'web' | null
  title?: string
  version?: string
  saveDir?: string
  renpyVersion?: string
  files: number
  engine?: EngineInfo
  v?: number
}

/** What made a game; Renplay installs Ren'Py games and, step by step, some others. */
export interface EngineInfo {
  family: string
  kind?: string
  version?: string
  label: string
  title?: string
  installable: boolean
  reason?: string
  warnings: string[]
}

export interface Archive {
  path: string
  name: string
  size: number
  mtime: number
  sha256: string | null
  info: ArchiveInfo | null
  installedAs: string | null
  recipe: { id: string; title: string; version: string | null; status: string; exact: boolean; cover: string | null; nsfw: boolean } | null
  existingGame: string | null
}

export interface RecipeRelease {
  version: string
  date?: string
  madeWith?: string
  runtime?: string
  status: 'verified' | 'playable' | 'broken' | 'untested'
  archives: Array<{ name: string; size?: number; sha256?: string }>
  verified?: { date?: string; renplay?: string; browsers?: string[]; notes?: string }
}

export interface Recipe {
  id: string
  title: string
  developer?: string
  tags?: string[]
  nsfw?: boolean
  cover?: string
  links?: Record<string, string>
  saveDir?: string
  continuesFrom?: string[]
  engine?: string
  releases: RecipeRelease[]
  local: { id: string; status: string; version: string } | null
}

export interface SystemInfo {
  version: string
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
  /** Archives are deleted once they installed (RENPLAY_DELETE_ARCHIVES). */
  deleteArchives: boolean
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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init
  const res = await fetch(path, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {}
    throw new ApiError(res.status, msg)
  }
  const ct = res.headers.get('content-type') ?? ''
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>
}

export const post = <T,>(path: string, json?: unknown) => api<T>(path, { method: 'POST', json: json ?? {} })
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' })


export function slotName(file: string): string {
  return file.replace(/-LT\d+\.save$/, '').replace(/\.save$/, '')
}

export function jobTitle(j: Job, games: Game[]): string {
  const game = games.find((g) => g.id === j.game)
  const name = game?.title ?? j.params?.source?.path?.split('/').pop() ?? j.params?.path?.split('/').pop() ?? j.game
  switch (j.type) {
    case 'import':
      return game && game.status === 'installed' && j.status !== 'done' ? `Updating ${name}` : `Installing ${name || 'game'}`
    case 'apply-mods':
      return `Applying mods to ${name}`
    case 'hash-archive':
      return `Checking ${name}`
    default:
      return j.type
  }
}
