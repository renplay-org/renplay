/**
 * This device's adult games level, kept in this browser for everyone who uses it. It can only
 * narrow: `api()` sends it with every request and the server applies it, so a level below Shown
 * on a phone used in public hides on every list, page and count, not only in the interface.
 */
export type DeviceLevel = 'off' | 'blurred'
export const DEVICE_KEY = 'renplay:adult-device'
export const DEVICE_EVENT = 'renplay:adult-device'
const MIGRATED = 'renplay:adult-device-migrated'

/**
 * 3.x kept a blur switch for the browser and a picture mode per account. Once per browser, the
 * lowest of them becomes this device's level, so nothing hidden before shows after the upgrade.
 */
function migrate(): void {
  try {
    if (localStorage.getItem(MIGRATED)) return
    const old: string[] = []
    let level: DeviceLevel | null = localStorage.getItem('renplay:blur-adult-covers') === '1' ? 'blurred' : null
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith('renplay:adult-pictures:')) continue
      old.push(key)
      const mode = localStorage.getItem(key)
      if (mode === 'hide-games') level = 'off'
      else if (mode === 'hide-pictures' && level !== 'off') level = 'blurred'
    }
    const current = deviceLevel()
    if (level && current !== 'off') localStorage.setItem(DEVICE_KEY, level === 'off' || current === null ? level : current)
    for (const key of [...old, 'renplay:blur-adult-covers']) localStorage.removeItem(key)
    localStorage.setItem(MIGRATED, '1')
  } catch {
    // Storage can be unavailable (private modes). The account's own level still applies.
  }
}

export function deviceLevel(): DeviceLevel | null {
  try {
    const v = localStorage.getItem(DEVICE_KEY)
    return v === 'off' || v === 'blurred' ? v : null
  } catch {
    return null
  }
}

export function setDeviceLevel(level: DeviceLevel | null): void {
  try {
    if (level) localStorage.setItem(DEVICE_KEY, level)
    else localStorage.removeItem(DEVICE_KEY)
  } catch {
    // Nothing to keep it in. The account's own level still applies.
  }
  window.dispatchEvent(new Event(DEVICE_EVENT))
}

migrate()
