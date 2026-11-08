import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type RefObject } from 'react'

/**
 * Reports the time played, in bounded increments, while `on` (the game is ready and neither
 * exiting nor failed).
 */
export function usePlayTime(on: boolean, gameId: string, userId: number, sandboxed: boolean, frameRef: RefObject<HTMLIFrameElement | null>, onSignedOut: () => void): void {
  const qc = useQueryClient()
  useEffect(() => {
    if (!on) return
    let previous = performance.now()
    let seconds = 0
    const report = () => {
      const whole = Math.min(60, Math.floor(seconds))
      if (whole < 1) return
      seconds -= whole
      void fetch(`/api/games/${gameId}/play-time`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-renplay-user': String(userId) }, body: JSON.stringify({ seconds: whole }), keepalive: true }).then((response) => { if (response.status === 401) onSignedOut() }).catch(() => {})
    }
    // A Ren'Py game left alone stops counting after 15 minutes without a tap, click or key, in the
    // game or on the player. A sandboxed game's input cannot be seen, so it counts while visible.
    let lastInput = performance.now()
    const onInput = () => {
      lastInput = performance.now()
    }
    const inputs = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    const targets: Window[] = [window]
    try {
      const inner = !sandboxed ? frameRef.current?.contentWindow : null
      if (inner) targets.push(inner)
    } catch {}
    for (const t of targets) for (const type of inputs) t.addEventListener(type, onInput, { capture: true, passive: true })
    const sample = () => {
      const now = performance.now()
      const active = sandboxed || now - lastInput < 15 * 60_000
      if (document.visibilityState === 'visible' && active) seconds += Math.min(2, (now - previous) / 1000)
      previous = now
      if (seconds >= 15) report()
    }
    const visibility = () => { previous = performance.now(); report() }
    const timer = window.setInterval(sample, 1000)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', report)
    return () => {
      for (const t of targets) for (const type of inputs) { try { t.removeEventListener(type, onInput, { capture: true }) } catch {} }
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', report)
      report()
      void qc.invalidateQueries({ queryKey: ['games'] })
      void qc.invalidateQueries({ queryKey: ['game', gameId] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, gameId, qc, sandboxed])
}
