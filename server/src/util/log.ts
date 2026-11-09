import { format } from 'node:util'

/*
 * The server's own log lines: the time (the server's TZ), a short area and the message, in the same
 * shape as nginx's request lines, so the pod log reads as one list. RENPLAY_LOG_LEVEL picks how
 * much: error, warn, info (the default) or debug.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

export function parseLogLevel(raw: string | undefined): LogLevel | null {
  const v = (raw ?? '').trim().toLowerCase()
  return v in ORDER ? (v as LogLevel) : null
}

let current: LogLevel | null = null
export function logLevel(): LogLevel {
  current ??= parseLogLevel(process.env['RENPLAY_LOG_LEVEL']) ?? 'info'
  return current
}

export function logs(level: LogLevel): boolean {
  return ORDER[level] <= ORDER[logLevel()]
}

/** 2026-11-07 12:01:14, in the server's time zone (TZ). */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * One log line: the date and time, the level, the area in brackets and a sentence, in fixed columns
 * (the layout Home Assistant uses). nginx writes its lines in the same columns.
 */
export function line(level: LogLevel, area: string, message: string): string {
  const text = message.replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/\n/g, '\n' + ' '.repeat(39))
  return `${stamp()}  ${level.padEnd(5)}  ${`[${area}]`.padEnd(10)} ${text}`
}

/** An event worth knowing about: a start, an install, a backup, a sign-in. */
export function log(area: string, message: string, level: LogLevel = 'info'): void {
  if (logs(level)) (level === 'error' ? console.error : console.log)(line(level, area, message))
}

/** A line that shows at every level, such as the setup code needed to claim a new server. */
export function always(area: string, message: string): void {
  console.log(line('info', area, message))
}

/** Areas a warning may name at its start ("catalog: …"), for its brackets. */
const AREAS = new Set(['catalog', 'config', 'art', 'job', 'backup', 'sign-in', 'library', 'saves'])

/**
 * Warnings and errors from anywhere in the server (console.warn and console.error) in the same
 * shape, and at the level asked for. Only the server's own entry point calls this.
 */
export function routeConsole(): void {
  const out = console.log.bind(console)
  const err = console.error.bind(console)
  const split = (text: string): [string, string] => {
    const m = /^([a-z][a-z-]*): (.*)$/s.exec(text)
    return m && AREAS.has(m[1]!) ? [m[1]!, m[2]!] : ['server', text]
  }
  console.warn = (...args: unknown[]) => {
    if (logs('warn')) out(line('warn', ...split(format(...args))))
  }
  console.error = (...args: unknown[]) => {
    const text = format(...args)
    // Lines this file already shaped pass through as they are.
    err(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d  /.test(text) ? text : line('error', ...split(text)))
  }
}


/** 3 m 12 s, 840 ms: a duration for people. */
export function took(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} m ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} m`
}
