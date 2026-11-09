import { HttpError } from '../util/paths.js'
import type { User } from './context.js'

/** An account as the API sends it: never its PIN's hash or lock. */
export function publicUser<T extends Partial<User>>(u: T): Omit<T, 'pin_hash' | 'pin_failures' | 'pin_locked_until'> & { hasPin: boolean } {
  const { pin_hash, pin_failures: _f, pin_locked_until: _l, ...rest } = u
  return { ...rest, hasPin: !!pin_hash }
}

export function validUsername(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}$/.test(value)) throw new HttpError(400, 'Use 2 to 64 letters, numbers, dots, dashes or underscores for the username')
  return value.toLowerCase()
}
export function validName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new HttpError(400, 'Enter a name with at most 100 characters')
  return value.trim()
}
