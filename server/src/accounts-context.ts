import { AsyncLocalStorage } from 'node:async_hooks'

export interface User {
  id: number
  username: string
  name: string
  role: 'admin' | 'player'
  adult_access: number
  disabled: number
  created_at: string
  prefs: string
}
export interface Viewer { user: User; session: string; bearer: boolean }
/** Request-local permissions; background installs deliberately have no viewer. */
export const viewers = new AsyncLocalStorage<Viewer>()
export const viewer = () => viewers.getStore()
