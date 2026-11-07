import { useEffect, useState, type ReactNode, type RefObject } from 'react'

/** The sticky phone action bar: it appears only once the stage's own Resume has left the viewport, so two lit Resumes are never on screen together. */
export default function ActionBar({ watch, children }: { watch?: RefObject<Element | null>; children: ReactNode }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const el = watch?.current
    if (!el) {
      setShow(true)
      return
    }
    const io = new IntersectionObserver(([entry]) => setShow(!entry.isIntersecting), { rootMargin: '-72px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [watch])
  return <div className={`actionbar ${show ? 'show' : ''}`}>{children}</div>
}
