import type { Game, Job } from '@shared/api'
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

export function ago(ts: number | string | null | undefined, relativeOnly = false): string {
  if (!ts) return 'never'
  const t = typeof ts === 'string' ? Date.parse(ts) : ts
  if (!Number.isFinite(t)) return 'never'
  const s = Math.round((t - Date.now()) / 1000)
  const abs = Math.abs(s)
  if (abs < 45) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  if (relativeOnly) return abs < 86400 * 365 ? rtf.format(Math.round(s / (86400 * 30)), 'month') : rtf.format(Math.round(s / (86400 * 365)), 'year')
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function dateTime(ts: number | string): string {
  const t = typeof ts === 'string' ? Date.parse(ts) : ts
  return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function duration(seconds: number | undefined): string {
  if (!seconds || seconds < 60) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

/** Upper-cases the first letter, for text that starts a line ("Just now", "Sci-fi"). */
export function capitalize(s: string): string {
  return s ? s[0]!.toLocaleUpperCase() + s.slice(1) : s
}

/** Play time as a phrase: "6 h 10 m played", "40 m played". */
/** Time played. Under a minute it says so, unless the game was never played: then there are no saves either. */
export function playedTime(seconds: number, played = false): string {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return played || seconds > 0 ? 'Under a minute played' : 'Not played yet'
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m played` : `${minutes} m played`
}

export function pct(f: number): string {
  return `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`
}

/** This browser's time zone, so the server groups play by the person's own days. */
export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

/** A save file's name without its Ren'Py suffixes: 1-1 for 1-1-LT1.save. */
export function slotName(file: string): string {
  return file.replace(/-LT\d+\.save$/, '').replace(/\.save$/, '')
}

/** What a job is about: the game's title, and the file name only when no game is known. */
export function jobSubject(j: Job): string | undefined {
  return j.title ?? (j.params?.source?.path ?? j.params?.path)?.split('/').pop() ?? (j.game || undefined)
}

/** The job in a sentence: Installing Pale Carnations. */
export function jobTitle(j: Job, games: Game[]): string {
  const name = jobSubject(j)
  switch (j.type) {
    case 'import':
      if (j.status === 'done') return `Installed ${name || 'game'}`
      return games.find((g) => g.id === j.game)?.status === 'installed' ? `Updating ${name}` : `Installing ${name || 'game'}`
    case 'apply-mods':
      return `${j.status === 'done' ? 'Applied' : 'Applying'} mods to ${name}`
    case 'hash-archive':
      return `${j.status === 'done' ? 'Checked' : 'Checking'} ${name}`
    default:
      return j.type
  }
}

/** A job's state or its stage: the line under an install's name. */
export function jobStage(j: { status: string; stage: string }, fallback: string): string {
  return j.status === 'queued' ? 'Queued' : j.status === 'paused' ? 'Paused' : j.stage || fallback
}
