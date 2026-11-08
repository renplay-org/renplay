/**
 * The same picture travels between the tile, the stage and the player door
 * instead of fading out and in. One FLIP ghost carries it: the clicked tile's
 * picture is lifted out and animated to where the same picture lands on the
 * next screen. Native view transitions are not used: the FLIP fallback is the
 * one code path that works the same in every browser. Reduced motion skips it.
 */

interface Travel {
  id: string
  src: string | null
  rect: { x: number; y: number; w: number; h: number }
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

/** Lift the picture at `rect` and fly it to `target`, then remove it. Calls `done` at the end (also on cancel). */
export function flyGhost(t: Travel, target: { x: number; y: number; w: number; h: number }, done: () => void): void {
  const el = document.createElement('div')
  el.className = 'ghost'
  el.style.left = `${t.rect.x}px`
  el.style.top = `${t.rect.y}px`
  el.style.width = `${t.rect.w}px`
  el.style.height = `${t.rect.h}px`
  if (t.src) {
    const img = document.createElement('img')
    img.src = t.src
    img.alt = ''
    el.append(img)
  }
  document.body.append(el)
  const finish = () => {
    el.remove()
    done()
  }
  try {
    const anim = el.animate(
      [
        { left: `${t.rect.x}px`, top: `${t.rect.y}px`, width: `${t.rect.w}px`, height: `${t.rect.h}px` },
        { left: `${target.x}px`, top: `${target.y}px`, width: `${target.w}px`, height: `${target.h}px` },
      ],
      { duration: 480, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' },
    )
    anim.onfinish = finish
    anim.oncancel = finish
  } catch {
    finish()
  }
}
