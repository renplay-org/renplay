import { useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, put } from './api'
import { useAuth } from './auth'

/**
 * The three adult levels, ordered so each one shows more than the previous.
 * Off: adult games do not exist. Blurred: they show without their pictures.
 * Shown: everything. The server enforces the person's level; this device can
 * only go lower, in this browser.
 */
export type AdultLevel = 'off' | 'blurred' | 'shown'
export const adultLevels: AdultLevel[] = ['off', 'blurred', 'shown']
export const adultLabels: Record<AdultLevel, string> = { off: 'Off', blurred: 'Blurred', shown: 'Shown' }

export function lowestLevel(...levels: AdultLevel[]): AdultLevel {
  return adultLevels[Math.min(...levels.map((l) => adultLevels.indexOf(l)))]!
}
export function isLevel(value: unknown): value is AdultLevel {
  return value === 'off' || value === 'blurred' || value === 'shown'
}

export interface AdultState {
  installation: { level: AdultLevel; fixed: boolean; chosen: boolean }
  ceiling: { level: AdultLevel; managed: 'group' | null }
  choice: AdultLevel
  /** The lowest of installation, ceiling and choice, as the server enforces it. */
  effective: AdultLevel
}

export function useAdultState() {
  return useQuery({ queryKey: ['me', 'adult'], queryFn: () => api<AdultState>('/api/me/adult') })
}

/** Saves the person's own level, then reloads everything it filters. */
export function useSetAdultChoice() {
  const qc = useQueryClient()
  return async (level: AdultLevel) => {
    await put('/api/me/adult', { level })
    await qc.invalidateQueries()
  }
}

const EVENT = 'renplay:adult-device'
function subscribe(cb: () => void) {
  window.addEventListener('storage', cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(EVENT, cb)
  }
}
const deviceKey = (user: number | undefined) => `renplay:adult-device:${user ?? ''}`

/**
 * 3.x kept two device settings: a blur switch for every account and a picture
 * mode per account. Each becomes this device's level once, then goes away.
 */
function migrateDevice(user: number) {
  const key = deviceKey(user)
  const picturesKey = `renplay:adult-pictures:${user}`
  const pictures = localStorage.getItem(picturesKey)
  const blur = localStorage.getItem('renplay:blur-adult-covers')
  if (localStorage.getItem(key) === null) {
    const level = pictures === 'hide-games' ? 'off' : pictures === 'hide-pictures' || blur === '1' ? 'blurred' : null
    if (level) localStorage.setItem(key, level)
  }
  if (pictures !== null) localStorage.removeItem(picturesKey)
  if (blur !== null) localStorage.removeItem('renplay:blur-adult-covers')
}

const migrated = new Set<number>()

/** This device's level for the signed-in person, or null when it follows their choice. */
export function useDeviceLevel(): [AdultLevel | null, (level: AdultLevel | null) => void] {
  const user = useAuth().data?.user.id
  // Before the first read, so an old blur setting never lets a picture through.
  if (user !== undefined && !migrated.has(user)) {
    migrated.add(user)
    migrateDevice(user)
  }
  const stored = useSyncExternalStore(subscribe, () => localStorage.getItem(deviceKey(user)))
  const set = (level: AdultLevel | null) => {
    if (level) localStorage.setItem(deviceKey(user), level)
    else localStorage.removeItem(deviceKey(user))
    window.dispatchEvent(new Event(EVENT))
  }
  return [isLevel(stored) ? stored : null, set]
}

/**
 * The level the interface applies: the server's level, narrowed by this
 * device. The server already leaves out what its level hides, so this only
 * has to apply the device's part.
 */
export function useAdultView(): AdultLevel {
  const { data } = useAdultState()
  const [device] = useDeviceLevel()
  // Until both are known, nothing adult is drawn as a picture.
  if (!data) return 'blurred'
  return lowestLevel(data.effective, device ?? 'shown')
}
