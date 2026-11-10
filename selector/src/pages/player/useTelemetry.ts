import { useCallback, useEffect, useRef } from 'react'
import { userHeader } from '../../lib/api'
import { deviceHeaders } from '../../lib/device'
import { browserEngine, deviceKind, isStandalone } from '../../lib/platform'

/**
 * What the player tells the server about a session of play, for the anonymous usage report: the
 * kind of device and browser, whether the game ran from the home screen, offline, with a controller
 * or in fullscreen, how long it took to load, how smoothly it ran, and the first line of an error.
 * Once per session, when it ends. No title and no name goes with it: the server names a game only by
 * its catalog recipe, and drops all of it when the report is off.
 */
export function useTelemetry(gameId: string, userId: number, state: { ready: boolean; online: boolean; fullscreen: boolean; failed: string | null }) {
  const started = useRef(performance.now())
  const seen = useRef({ loadSeconds: -1, offline: false, controller: false, fullscreen: false, fps: -1, homeScreen: false })
  const sent = useRef(false)
  const errorSent = useRef('')

  const post = useCallback((body: Record<string, unknown>) => {
    void fetch('/api/telemetry/client', {
      method: 'POST',
      headers: { ...deviceHeaders(), ...userHeader(userId), 'content-type': 'application/json' },
      body: JSON.stringify({ game: gameId, ...body }),
      keepalive: true,
    }).catch(() => {})
  }, [gameId, userId])

  const { ready, online, fullscreen, failed } = state
  useEffect(() => {
    if (ready && seen.current.loadSeconds < 0) {
      seen.current.loadSeconds = Math.round((performance.now() - started.current) / 100) / 10
      seen.current.homeScreen = isStandalone()
    }
  }, [ready])
  useEffect(() => {
    if (ready && !online) seen.current.offline = true
  }, [ready, online])
  useEffect(() => {
    if (ready && fullscreen) seen.current.fullscreen = true
  }, [ready, fullscreen])
  useEffect(() => {
    if (!ready) return
    const pad = () => { seen.current.controller = true }
    if ([...(navigator.getGamepads?.() ?? [])].some(Boolean)) pad()
    window.addEventListener('gamepadconnected', pad)
    return () => window.removeEventListener('gamepadconnected', pad)
  }, [ready])
  // A failure is reported on its own, so a retry that works is still one session.
  useEffect(() => {
    if (failed && failed !== errorSent.current) {
      errorSent.current = failed
      post({ error: failed })
    }
  }, [failed, post])

  // The session ends when the player closes or the page goes away.
  useEffect(() => {
    const end = () => {
      const s = seen.current
      if (sent.current || s.loadSeconds < 0) return
      sent.current = true
      post({ device: deviceKind(), browser: browserEngine(), homeScreen: s.homeScreen, offline: s.offline, controller: s.controller, fullscreen: s.fullscreen, loadSeconds: s.loadSeconds, ...(s.fps >= 0 ? { fps: s.fps } : {}) })
    }
    window.addEventListener('pagehide', end)
    return () => {
      window.removeEventListener('pagehide', end)
      end()
    }
  }, [post])

  return { fps: (value: number) => { seen.current.fps = value } }
}
