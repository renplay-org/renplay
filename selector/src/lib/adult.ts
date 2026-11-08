import { useSyncExternalStore } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, put } from './api'
import { DEVICE_EVENT, deviceLevel, setDeviceLevel } from './device'
import { lowestLevel, type AdultLevel } from '@shared/levels'

/** The levels' names. The server enforces the person's level and this device's, which can only go lower. */
export const adultLabels: Record<AdultLevel, string> = { off: 'Off', blurred: 'Blurred', shown: 'Shown' }


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

/** This device's level, or null when it follows the person's choice. Changing it reloads everything, since the server applies it. */
export function useDeviceLevel(): [AdultLevel | null, (level: AdultLevel | null) => void] {
  const qc = useQueryClient()
  const stored = useSyncExternalStore(subscribe, deviceLevel)
  const set = (level: AdultLevel | null) => {
    setDeviceLevel(level === 'off' || level === 'blurred' ? level : null)
    void qc.invalidateQueries()
  }
  return [stored, set]
}

function subscribe(cb: () => void) {
  window.addEventListener('storage', cb)
  window.addEventListener(DEVICE_EVENT, cb)
  return () => {
    window.removeEventListener('storage', cb)
    window.removeEventListener(DEVICE_EVENT, cb)
  }
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
