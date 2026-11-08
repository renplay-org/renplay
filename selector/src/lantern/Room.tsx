import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLighterBackground } from '../lib/backdrop'
import type { ArtSet } from '@shared/art'
import { formatFor, hashUrl, tintOf, useHidden, type ArtGame } from './art'

export interface RoomTarget {
  game: (ArtGame & { id: string }) | null
  quiet?: boolean
  brand?: boolean
}

const RoomCtx = createContext<(t: RoomTarget) => void>(() => {})

/** Points the room at a game (or the brand glow with `brand`, dimmed with `quiet`). */
export function useRoom(target: RoomTarget): void {
  const set = useContext(RoomCtx)
  const id = target.game?.id ?? null
  useEffect(() => {
    set(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!target.quiet, !!target.brand, set])
}

/** The picture the room shows for a game: its hero (or wide, or grid), the hash below Shown. */
function roomArt(game: ArtGame, hidden: boolean): { src: string | null; tint: string } {
  const art: ArtSet | undefined = game.art
  for (const kind of ['hero', 'wide', 'grid'] as const) {
    const f = formatFor(art, kind)
    if (!f) continue
    const src = !hidden && f.url1x ? f.url1x : hashUrl(f.thumbhash)
    if (src) return { src, tint: f.tint ?? tintOf(art) }
  }
  return { src: null, tint: tintOf(art) }
}

/**
 * The room: two crossfading layers behind every screen, the focused game's
 * hero blurred, darkened to 60 percent and capped at 50 percent opacity under
 * content, tinted by the game. It changes with the game in focus.
 */
export function RoomProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<RoomTarget>({ game: null, quiet: true })
  const hidden = useHidden(target.game ?? { title: '' })
  const lighter = useLighterBackground().on
  const [layers, setLayers] = useState<Array<{ key: number; src: string | null }>>([])
  const nextKey = useRef(0)
  const art = useMemo(() => (target.game && !target.brand ? roomArt(target.game, hidden) : null), [target, hidden])

  useEffect(() => {
    const src = art?.src ?? null
    setLayers((cur) => {
      if (cur.length && cur[cur.length - 1]!.src === src) return cur
      return [...cur.slice(-1), { key: nextKey.current++, src }]
    })
    const t = window.setTimeout(() => setLayers((cur) => cur.slice(-1)), 650)
    return () => clearTimeout(t)
  }, [art?.src])

  useEffect(() => {
    document.documentElement.style.setProperty('--tint', target.brand ? '#8b6bff' : (art?.tint ?? '#5a5a7a'))
  }, [art?.tint, target.brand])

  return (
    <RoomCtx.Provider value={setTarget}>
      <div className={`bd ${target.brand ? 'brand' : ''} ${target.quiet ? 'quiet' : ''}`.replace(/\s+/g, ' ').trim()} aria-hidden="true">
        {/* Lighter background: only the game's tint, and no picture is loaded for it. */}
        {!lighter &&
          layers.map((l, i) => (
            <div key={l.key} className={`l ${i === layers.length - 1 ? 'on' : ''}`}>
              {l.src && <img src={l.src} alt="" />}
            </div>
          ))}
        <div className="glow" />
      </div>
      {children}
    </RoomCtx.Provider>
  )
}
