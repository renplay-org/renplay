/** A size for people, in 1000s: 0 B, 812 KB, 1.4 MB, 12 GB. */
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

/** A disk with less than 10 percent or 1 GB free: Settings warns, and the log does once a day. */
export function lowSpace(disk: { total: number; free: number } | null): boolean {
  return !!disk && disk.total > 0 && (disk.free < 1e9 || disk.free < disk.total / 10)
}
