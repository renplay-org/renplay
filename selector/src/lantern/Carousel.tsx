import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { IconBtn } from './controls'
import { reducedMotion } from './travel'
import './Carousel.css'

/** How long a slide stays before the next one comes. */
const ROTATE_MS = 7000

/** The slide a person left, so coming back shows it again (the artwork flies back to its cover). */
let leftAt: string | null = null
/** Whether a person moved it: it stays still for them until the page is loaded again. */
let movedByPerson = false

/** Whether the browser says when a scroll has stopped (Safari does from 26.2). */
const SCROLL_END = 'onscrollend' in (window as object)

/** How long the scrolling must stay still before the jump back to the real slides, in a browser without `scrollend`. */
const SETTLE_MS = 120

/**
 * One slide at a time, side by side: swipe or scroll sideways (scroll snapping does the moving), arrows on a
 * desktop, a row of dots under it, the arrow keys while it has focus. It turns the page by itself every
 * few seconds, but not while a finger, the mouse or keyboard focus is on it, never once the person has moved
 * it themselves, and not with reduced motion.
 *
 * It goes round: a copy of the last slide stands before the first and a copy of the first after the last, so
 * the move past either end is an ordinary move, and once it has stopped on a copy the scroll jumps to the
 * real slide, which looks the same. The copies are hidden from screen readers and focus. Places in the box
 * ("positions") count the copies, slides ("index") do not.
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
  /** Where the box is scrolled to, counting the copy in front: 0 is the copy of the last slide, 1 the first slide. */
  const [position, setPosition] = useState(() => Math.max(0, items.findIndex((item) => item.id === leftAt)) + (items.length > 1 ? 1 : 0))
  const touchingNow = useRef(false)
  /** The person moved it: it stays where they put it. */
  const [stopped, setStopped] = useState(movedByPerson)
  /** Something holds it: the mouse over it, a finger on it, focus in it. */
  const [holds, setHolds] = useState<ReadonlySet<'mouse' | 'touch' | 'focus'>>(new Set())
  const count = items.length
  const loops = count > 1
  /** The slide in view: a copy counts as its original. */
  const here = loops ? (position - 1 + count) % count : 0

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

  /** Scrolls the box to a position, with no moving (no scroll snapping is waited for). */
  const jump = (to: number) => box.current?.scrollTo({ left: to * box.current.clientWidth, behavior: 'instant' })
  const positionNow = (el: HTMLElement) => Math.round(el.scrollLeft / el.clientWidth)

  /** Resting on a copy: the real slide that looks the same takes its place, unseen. */
  const settle = () => {
    const el = box.current
    if (!el || touchingNow.current || !loops) return
    const at = positionNow(el)
    if (at !== 0 && at !== count + 1) return
    // Still moving (a snap on its way): wait for the next stop.
    if (Math.abs(el.scrollLeft - at * el.clientWidth) > 1) return
    jump(at === 0 ? count : 1)
  }

  /** To a slide. Past either end the copy is the place to move to, and `settle` makes it the real one. */
  const goTo = (i: number, instant = false) => {
    const el = box.current
    if (!el) return
    if (instant || reducedMotion()) return jump(loops ? ((i + count) % count) + 1 : i)
    el.scrollTo({ left: (loops ? i + 1 : i) * el.clientWidth, behavior: 'smooth' })
  }

  /** The slide before or after the one in view, round the ends. */
  const step = (by: 1 | -1) => {
    const el = box.current
    if (!el || !loops) return
    let at = positionNow(el)
    // On a copy and going on past it (a second press before the jump): the real slide first.
    if (at + by < 0 || at + by > count + 1) {
      at = at === 0 ? count : 1
      jump(at)
    }
    goTo(at + by - 1)
  }

  // Back on the page: the slide the person left. The same when the number of slides changes, for the copies come and go.
  useLayoutEffect(() => {
    const at = here + (loops ? 1 : 0)
    setPosition(at)
    jump(at)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  // The scroll has stopped: no `scrollend` in older Safari, so the quiet after the last scroll event stands in for it.
  const quiet = useRef<number>(0)
  useEffect(() => {
    const el = box.current
    if (!el || !loops) return
    const done = () => settle()
    el.addEventListener('scrollend', done)
    return () => el.removeEventListener('scrollend', done)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loops, count])
  useEffect(() => () => window.clearTimeout(quiet.current), [])

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
    const timer = window.setTimeout(() => step(1), ROTATE_MS)
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
          const at = positionNow(el)
          if (at !== position) setPosition(at)
          // A scroll under a finger is the person's.
          if (touching) stop()
          if (loops && !SCROLL_END) {
            window.clearTimeout(quiet.current)
            quiet.current = window.setTimeout(settle, SETTLE_MS)
          }
        }}
        onTouchStart={() => {
          touchingNow.current = true
          hold('touch', true)
        }}
        onTouchEnd={() => {
          touchingNow.current = false
          hold('touch', false)
          // A finger lifted on a copy with nothing left to scroll: no scroll event will follow to settle it.
          if (loops) {
            window.clearTimeout(quiet.current)
            quiet.current = window.setTimeout(settle, SETTLE_MS)
          }
        }}
        onTouchCancel={() => {
          touchingNow.current = false
          hold('touch', false)
        }}
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
          step(e.key === 'ArrowRight' ? 1 : -1)
        }}
      >
        {loops && <Copy>{slide(items[count - 1]!)}</Copy>}
        {items.map((item, i) => (
          <div key={item.id} className="slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} inert={i !== here}>
            {slide(item)}
          </div>
        ))}
        {loops && <Copy>{slide(items[0]!)}</Copy>}
      </div>
      {count > 1 && (
        <>
          <IconBtn
            label="Previous"
            className="car-arrow prev hide-phone"
            onClick={() => {
              stop()
              step(-1)
            }}
          >
            <ChevronLeft />
          </IconBtn>
          <IconBtn
            label="Next"
            className="car-arrow next hide-phone"
            onClick={() => {
              stop()
              step(1)
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

/** A slide's twin at the other end: for looking at only, so no screen reader, tab stop or click reaches it. */
function Copy({ children }: { children: ReactNode }) {
  return (
    <div className="slide copy" aria-hidden="true" inert>
      {children}
    </div>
  )
}
