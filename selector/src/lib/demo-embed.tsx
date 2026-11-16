import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { embedMessage, visitorKeyFrom } from '@shared/demo-embed'
import { ApiError, post } from './api'
import { useAuth } from './auth'
import { useGames } from './queries'
import { isTouchDevice } from './platform'

type EmbedMode = 'laptop' | 'phone'
const EmbedContext = createContext<EmbedMode | null>(null)

export function useDemoEmbed() {
  return useContext(EmbedContext)
}

function demoEmbedMode(search: string): EmbedMode | null {
  const mode = new URLSearchParams(search).get('embed')
  return mode === 'laptop' || mode === 'phone' ? mode : null
}

const VISITOR_STORED = 'renplay-demo-visitor'

/**
 * The visitor key the website hands to its frames in the address fragment (#visitor=KEY). It is
 * kept for this tab and taken out of the address, so a reload or a copied link does not carry it.
 */
function visitorKey(): string | null {
  const found = visitorKeyFrom(location.hash)
  if (found) {
    try { sessionStorage.setItem(VISITOR_STORED, found) } catch { /* A tab that cannot store keeps it until it reloads. */ }
    history.replaceState(history.state, '', location.pathname + location.search)
    return found
  }
  try { return visitorKeyFrom(`#visitor=${sessionStorage.getItem(VISITOR_STORED) ?? ''}`) } catch { return null }
}

/**
 * Signs the visitor in as their own guest in the demo. With a visitor key (the website's frames
 * have one) the key names the guest, so both frames are one guest, even with no cookie shared
 * between them. A plain embedded visit makes a guest when nobody is signed in. Returns what to
 * show while it works, or null.
 */
export function useDemoGuest(demo: boolean | undefined, me: UseQueryResult<unknown>): 'working' | 'failed' | null {
  const key = useMemo(() => demo ? visitorKey() : null, [demo])
  const embedded = useRef(demoEmbedMode(location.search) !== null).current
  const exchanged = useRef(false)
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle')
  const unauthorized = me.error instanceof ApiError && me.error.status === 401
  const wanted = !!demo && state === 'idle' && (key !== null && !exchanged.current || (key !== null || embedded) && unauthorized)
  useEffect(() => {
    if (!wanted) return
    exchanged.current = true
    setState('working')
    void post('/api/auth/demo', key ? { visitor: key } : {})
      .then(() => me.refetch())
      .then((result) => setState(result.isError ? 'failed' : 'idle'), () => setState('failed'))
  }, [wanted, key, me.refetch])
  return wanted || state === 'working' ? 'working' : state === 'failed' ? 'failed' : null
}

/** Only the authenticated public demo enables the website bridge. */
export function DemoEmbed({ children }: { children: ReactNode }) {
  const { data: me } = useAuth()
  const initial = useRef(demoEmbedMode(location.search)).current
  const mode = me?.demo && me.demoEmbedder ? initial : null
  return <EmbedContext value={mode}>{mode && <Bridge mode={mode} origin={me!.demoEmbedder!} />}{children}</EmbedContext>
}

function Bridge({ mode, origin }: { mode: EmbedMode; origin: string }) {
  const here = useLocation(), navigate = useNavigate(), qc = useQueryClient()
  const games = useGames()
  const ready = useRef(false), engaged = useRef(false)
  const previous = useRef(new Map<string, string>())
  const post = (type: string, detail = {}) => {
    if (window.parent !== window) window.parent.postMessage({ type: `renplay-embed:${type}`, ...detail }, origin)
  }
  useLayoutEffect(() => {
    const params = new URLSearchParams(here.search)
    if (params.get('embed') === mode) return
    params.set('embed', mode)
    navigate({ pathname: here.pathname, search: params.toString(), hash: here.hash }, { replace: true })
  }, [here, mode, navigate])
  useEffect(() => {
    if (!games.data) return
    for (const game of games.data) {
      const signature = JSON.stringify([game.latestSave, game.saves])
      const before = previous.current.get(game.id)
      previous.current.set(game.id, signature)
      if (before !== undefined && before !== signature) post('saved', { gameId: game.id, label: game.latestSave?.label ?? null, time: game.latestSave?.ctime ?? null })
    }
    if (!ready.current) { ready.current = true; post('ready') }
  }, [games.data])
  useEffect(() => {
    const refresh = () => {
      for (const key of ['saves', 'games', 'game']) void qc.invalidateQueries({ queryKey: [key] })
    }
    const message = (event: MessageEvent) => {
      const command = embedMessage(event, origin, window.parent)
      if (command === 'refresh') refresh()
      if (command === 'nudge') {
        const button = [...document.querySelectorAll('a[href^="/play/"]')].find((element) => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
        })
        if (button && !matchMedia('(prefers-reduced-motion: reduce)').matches) button.animate([
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.06)', filter: 'brightness(1.25)' },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ], { duration: 800, easing: 'ease-in-out' })
      }
    }
    const interaction = (event: Event) => {
      if (!event.isTrusted || engaged.current) return
      engaged.current = true
      post('engaged')
    }
    window.addEventListener('message', message)
    window.addEventListener('renplay:saves-changed', refresh)
    window.addEventListener('pointerdown', interaction, { passive: true })
    window.addEventListener('keydown', interaction)
    return () => {
      window.removeEventListener('message', message)
      window.removeEventListener('renplay:saves-changed', refresh)
      window.removeEventListener('pointerdown', interaction)
      window.removeEventListener('keydown', interaction)
    }
  }, [origin, qc])
  return null
}

/** A play link that leaves the website's frame carries the visitor key, so the guest stays the same there. */
export function demoPlayTo(mode: EmbedMode | null, to: string): string {
  const key = demoPlayTarget(mode) ? visitorKey() : null
  return key ? `${to}#visitor=${key}` : to
}

/** A touch screen plays outside the website's small device frame. */
export function demoPlayTarget(mode: EmbedMode | null): '_top' | undefined {
  return mode && isTouchDevice() ? '_top' : undefined
}
