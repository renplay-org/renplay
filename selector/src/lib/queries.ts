import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useAuth } from './auth'
import { useAdultPictures } from './prefs'
import { api, put, type CatalogResponse, type ContentState, type Archive, type FilesResponse, type Game, type Job, type SavesResponse, type SystemInfo } from './api'

export function useGames() {
  const [mode] = useAdultPictures()
  return useQuery({
    queryKey: ['games'],
    select: (games) => mode === 'hide-games' ? games.filter((g) => !g.nsfw) : games,
    queryFn: () => api<{ games: Game[] }>('/api/games').then((r) => r.games),
    refetchInterval: (q) => (q.state.data?.some((g) => g.job) ? 2000 : false),
  })
}

export function useGame(id: string | undefined) {
  return useQuery({
    queryKey: ['game', id],
    queryFn: () => api<{ game: Game }>(`/api/games/${id}`).then((r) => r.game),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.job ? 2000 : false),
  })
}

export function useSaves(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['saves', id],
    queryFn: () => api<SavesResponse>(`/api/saves/${id}`),
    enabled: !!id && enabled,
  })
}

export function useJobs() {
  const admin = useAuth().data?.user.role === 'admin'
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['jobs'],
    enabled: admin,
    queryFn: () => api<{ jobs: Job[]; busy: boolean }>('/api/jobs?limit=40'),
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => j.status === 'running' || j.status === 'queued') ? 1500 : 15000),
  })
  // Refresh game data when a job finishes.
  const active = useRef<Set<string>>(new Set())
  useEffect(() => {
    const now = new Set((q.data?.jobs ?? []).filter((j) => j.status === 'running' || j.status === 'queued').map((j) => j.id))
    let finished = false
    for (const id of active.current) if (!now.has(id)) finished = true
    active.current = now
    if (finished) {
      void qc.invalidateQueries({ queryKey: ['games'] })
      void qc.invalidateQueries({ queryKey: ['game'] })
      void qc.invalidateQueries({ queryKey: ['archives'] })
      void qc.invalidateQueries({ queryKey: ['files'] })
      void qc.invalidateQueries({ queryKey: ['system'] })
    }
  }, [q.data, qc])
  return q
}

export function useArchives() {
  return useQuery({ queryKey: ['archives'], queryFn: () => api<{ dir: string; archives: Archive[] }>('/api/archives') })
}

export function useCatalog() {
  const [mode] = useAdultPictures()
  return useQuery({
    queryKey: ['catalog'],
    select: (catalog) => mode === 'hide-games' ? { ...catalog, games: catalog.games.filter((g) => !g.nsfw) } : catalog,
    queryFn: () => api<CatalogResponse>('/api/catalog'),
  })
}

export function useContent() {
  return useQuery({ queryKey: ['content'], queryFn: () => api<ContentState>('/api/content') })
}

/** Saves the choice, then reloads everything that depends on it. */
export function useSetAdultGames() {
  const qc = useQueryClient()
  return async (adultGames: ContentState['adultGames']) => {
    await put('/api/content', { adultGames })
    await qc.invalidateQueries()
  }
}

export function useSystem() {
  const admin = useAuth().data?.user.role === 'admin'
  return useQuery({ enabled: admin, queryKey: ['system'], queryFn: () => api<SystemInfo>('/api/system') })
}

export function useFiles(id: string, dir: string) {
  return useQuery({
    queryKey: ['files', id, dir],
    queryFn: () => api<FilesResponse>(`/api/games/${id}/files?dir=${encodeURIComponent(dir)}`),
  })
}
