import { flushSync } from 'react-dom'
import type { ArtSet } from '@shared/art'
import { hashUrl } from './art'

/**
 * The same picture travels between the tile, the stage and the player door
 * instead of fading out and in. One FLIP ghost carries it: the clicked tile's
 * picture is lifted out and animated to where the same picture lands on the
 * next screen, and back to its tile when the person leaves the game page. The
 * picture is always the game's vertical (2:3 grid) art, so it keeps its shape
 * on the way. Native view transitions are not used: the FLIP fallback is the
 * one code path that works the same in every browser. Reduced motion skips it.
 */

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Travel {
  id: string
  src: string | null
  rect: Box
}

let pending: Travel | null = null

export function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function startTravel(t: Travel): void {
  if (reducedMotion()) return
  pending = t
}

export function takeTravel(id: string): Travel | null {
  if (pending?.id !== id) return null
  const t = pending
  pending = null
  return t
}

/** The picture a game's tile and cover fly with: the vertical art, or its hash while that is hidden. */
export function travelSource(art: ArtSet | undefined, hidden: boolean): string | null {
  const grid = art?.grid
  return (!hidden && grid?.url1x) || hashUrl(grid?.thumbhash)
}

/** The longest the ghost waits at its end for what lands under it to be ready. */
const READY_MS = 400

/**
 * Lift the picture at `t.rect` and fly it to `target`, then remove it. The same shape on both ends (a tile and a
 * cover, both 2:3) moves by transform alone, which the compositor does without layout on every frame, so it
 * stays smooth on a phone. The door is another shape, and animates the box.
 *
 * `done` reveals what lands under the ghost, and is called (also on cancel) in the same task that removes the
 * ghost, so no frame shows neither: a change of React state in it is made at once. `ready`, if given, is awaited
 * first, with the ghost holding its last frame: the landing picture is decoded by then, and does not show its
 * placeholder for a frame when it appears.
 */
export function flyGhost(t: Travel, target: Box, done: () => void, ms = 480, ready?: () => Promise<unknown>): void {
  const el = document.createElement('div')
  el.className = 'ghost'
  if (t.src) {
    const img = document.createElement('img')
    img.src = t.src
    img.alt = ''
    el.append(img)
  }
  const from = t.rect
  const sameShape = Math.abs(from.w / from.h - target.w / target.h) <= (from.w / from.h) * 0.02
  let frames: Keyframe[]
  if (sameShape) {
    // Sized as the larger end and scaled down at the other, so the picture is never scaled up and blurred.
    const big = from.w >= target.w ? from : target
    const radius = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--r-tile')) || 10
    const at = (b: Box) => ({ transform: `translate(${b.x}px, ${b.y}px) scale(${b.w / big.w})`, borderRadius: `${radius / (b.w / big.w)}px` })
    el.style.cssText = `left:0;top:0;width:${big.w}px;height:${big.h}px;`
    frames = [at(from), at(target)]
  } else {
    el.style.cssText = `left:${from.x}px;top:${from.y}px;width:${from.w}px;height:${from.h}px;`
    frames = [from, target].map((b) => ({ left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }))
  }
  document.body.append(el)
  const finish = () => {
    flushSync(done)
    el.remove()
  }
  try {
    const anim = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' })
    anim.onfinish = () => {
      if (!ready) return finish()
      void Promise.race([ready().catch(() => {}), new Promise((wait) => window.setTimeout(wait, READY_MS))]).then(finish)
    }
    anim.oncancel = finish
  } catch {
    finish()
  }
}
