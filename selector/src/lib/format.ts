export function bytes(n: number | null | undefined): string {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

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
export function playedTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return 'Not played yet'
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m played` : `${minutes} m played`
}

export function pct(f: number): string {
  return `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`
}
