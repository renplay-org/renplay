import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { IconBtn } from './controls'
import { reducedMotion } from './travel'

/** How long a slide stays before the next one comes. */
const ROTATE_MS = 7000

/** The slide a person left, so coming back shows it again (the artwork flies back to its cover). */
let leftAt: string | null = null
/** Whether a person moved it: it stays still for them until the page is loaded again. */
let movedByPerson = false

/**
 * One slide at a time, side by side: swipe or scroll sideways (scroll snapping does the moving), arrows on a
 * desktop, a row of dots under it, the arrow keys while it has focus. It turns the page by itself every
 * few seconds, but not while a finger, the mouse or keyboard focus is on it, never once the person has moved
 * it themselves, and not with reduced motion.
 */
export default function Carousel<T extends { id: string; title: string }>({
  items,
  label,
  slide,
  onSlide,
}: {
  items: T[]
  /** What the carousel is: a screen reader says it first. */
  label: string
  slide: (item: T) => ReactNode
  /** The slide in view changed. */
  onSlide?: (item: T) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(() => Math.max(0, items.findIndex((item) => item.id === leftAt)))
  /** The person moved it: it stays where they put it. */
  const [stopped, setStopped] = useState(movedByPerson)
  /** Something holds it: the mouse over it, a finger on it, focus in it. */
  const [holds, setHolds] = useState<ReadonlySet<'mouse' | 'touch' | 'focus'>>(new Set())
  const count = items.length
  const here = Math.min(index, count - 1)

  const stop = () => {
    movedByPerson = true
    setStopped(true)
  }
  const hold = (kind: 'mouse' | 'touch' | 'focus', on: boolean) =>
    setHolds((now) => {
      if (now.has(kind) === on) return now
      const next = new Set(now)
      if (on) next.add(kind)
      else next.delete(kind)
      return next
    })

  const goTo = (i: number, instant = false) => {
    const el = box.current
    if (!el) return
    const to = Math.max(0, Math.min(count - 1, i))
    el.scrollTo({ left: to * el.clientWidth, behavior: instant || reducedMotion() ? 'instant' : 'smooth' })
  }

  // Back on the page: the slide the person left.
  useLayoutEffect(() => {
    if (index) goTo(index, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const item = items[here]
    if (item) {
      leftAt = item.id
      onSlide?.(item)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, items[here]?.id])

  // Turning by itself: one timer per slide shown, dropped when anything holds it.
  useEffect(() => {
    if (count < 2 || stopped || holds.size || reducedMotion()) return
    const timer = window.setTimeout(() => goTo((here + 1) % count), ROTATE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, count, stopped, holds])

  if (!count) return null
  const touching = holds.has('touch')
  return (
    <section
      className="carousel-wrap"
      aria-roledescription="carousel"
      aria-label={label}
      onPointerEnter={(e) => e.pointerType === 'mouse' && hold('mouse', true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && hold('mouse', false)}
      onFocus={() => hold('focus', true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && hold('focus', false)}
    >
      <div
        ref={box}
        className="carousel"
        tabIndex={0}
        aria-live={stopped || holds.size ? 'polite' : 'off'}
        onScroll={(e) => {
          const el = e.currentTarget
          const i = Math.round(el.scrollLeft / el.clientWidth)
          if (i !== index) setIndex(i)
          // A scroll under a finger is the person's.
          if (touching) stop()
        }}
        onTouchStart={() => hold('touch', true)}
        onTouchEnd={() => hold('touch', false)}
        onTouchCancel={() => hold('touch', false)}
        onWheel={(e) => {
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) stop()
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          if ((e.target as HTMLElement).closest('input, textarea, select')) return
          // The page's own arrow keys (tile to tile) are not for this.
          e.preventDefault()
          e.stopPropagation()
          stop()
          goTo(here + (e.key === 'ArrowRight' ? 1 : -1))
        }}
      >
        {items.map((item, i) => (
          <div key={item.id} className="slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} inert={i !== here}>
            {slide(item)}
          </div>
        ))}
      </div>
      {count > 1 && (
        <>
          <IconBtn
            label="Previous"
            className="car-arrow prev hide-phone"
            disabled={here === 0}
            onClick={() => {
              stop()
              goTo(here - 1)
            }}
          >
            <ChevronLeft />
          </IconBtn>
          <IconBtn
            label="Next"
            className="car-arrow next hide-phone"
            disabled={here === count - 1}
            onClick={() => {
              stop()
              goTo(here + 1)
            }}
          >
            <ChevronRight />
          </IconBtn>
          <div className="dots">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className="dot"
                aria-label={`Show ${item.title}`}
                aria-current={i === here ? 'true' : undefined}
                onClick={() => {
                  stop()
                  goTo(i)
                }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
