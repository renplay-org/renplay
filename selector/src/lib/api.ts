export interface Game {
  slug: string
  title: string
  tags: string[]
  thumbnail: string | null
  walkthrough: string | null
  status: 'installed' | 'not_installed' | 'installing' | 'broken'
  layout: 'legacy' | 'managed' | 'none'
  buildId: string
  playUrl: string | null
  version: string | null
  renpyVersion: string | null
  engine: string | null
  sizeBytes: number
  fileCount: number
  screen: [number, number] | null
  saveDir: string | null
  saveDirSource: string | null
  source: { kind: string; archive: string | null; filename: string | null; url: string | null }
  canReinstall: boolean
  catalogId: string | null
  installedAt: string | null
  lastPlayedAt: string | null
  sortOrder: number
  saves: { count: number; latest: number }
  mods: { files: number; hash: string; state: string }
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
  slug: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted'
  stage: string
  progress: number
  message: string
  error: string | null
  params: { source?: { kind: string; path?: string; url?: string }; slug?: string; path?: string } | null
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
}

export interface Archive {
  path: string
  name: string
  size: number
  mtime: number
  sha256: string | null
  info: ArchiveInfo | null
  installedAs: string | null
  recipe: { id: string; title: string; version: string; status: string; exact: boolean } | null
  existingGame: string | null
}

export interface Recipe {
  id: string
  title: string
  developer?: string
  description?: string
  tags?: string[]
  nsfw?: boolean
  cover?: string
  links?: Record<string, string>
  saveDir?: string
  releases: Array<{ version: string; date?: string; renpy?: string; status: string; archives: Array<{ name: string; size?: number; sha256?: string }> }>
  local: { slug: string; status: string; version: string } | null
}

export interface SystemInfo {
  version: string
  sdk: { version: string; installed: string[] }
  engines: string[]
  disk: { games: { total: number; free: number } | null; data: { total: number; free: number } | null }
  library: { games: number; installed: number; bytes: number }
  paths: { games: string; archives: string; data: string }
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
  mods: { files: number; deleted: number; hash: string; state: string; job: boolean }
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

export function thumbUrl(g: Pick<Game, 'thumbnail'>): string | null {
  return g.thumbnail ? `/api/thumbnails/${encodeURIComponent(g.thumbnail)}` : null
}

export function slotName(file: string): string {
  return file.replace(/-LT\d+\.save$/, '').replace(/\.save$/, '')
}

export function jobTitle(j: Job, games: Game[]): string {
  const game = games.find((g) => g.slug === j.slug)
  const name = game?.title ?? j.params?.source?.path?.split('/').pop() ?? j.params?.path?.split('/').pop() ?? j.slug
  switch (j.type) {
    case 'import':
      return game && game.status === 'installed' && j.status !== 'done' ? `Updating ${name}` : `Installing ${name || 'game'}`
    case 'analyze':
      return `Analyzing ${name}`
    case 'optimize':
      return `Optimizing ${name}`
    case 'apply-mods':
      return `Applying mods to ${name}`
    case 'install-sdk':
      return 'Installing the Ren’Py SDK'
    case 'hash-archive':
      return `Checking ${name}`
    default:
      return j.type
  }
}
