import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { embedMessage } from '@shared/demo-embed'
import { useAuth } from './auth'
import { useGames } from './queries'
import { isTouchDevice } from './platform'

type EmbedMode = 'laptop' | 'phone'
const EmbedContext = createContext<EmbedMode | null>(null)

export function useDemoEmbed() {
  return useContext(EmbedContext)
}

export function demoEmbedMode(search: string): EmbedMode | null {
  const mode = new URLSearchParams(search).get('embed')
  return mode === 'laptop' || mode === 'phone' ? mode : null
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

/** A touch screen plays outside the website's small device frame. */
export function demoPlayTarget(mode: EmbedMode | null): '_top' | undefined {
  return mode && isTouchDevice() ? '_top' : undefined
}
