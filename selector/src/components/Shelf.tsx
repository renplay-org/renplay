import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

/** A shelf: tiles scrolling sideways with snap, one row. Empty shelves are not shown. */
export default function Shelf({ title, count, href, children }: { title: string; count: number; href?: string; children: ReactNode }) {
  if (!count) return null
  return (
    <section className="sec">
      <div className="sec-h">
        <h2 className="h2">
          {title}
          <span className="n">{count}</span>
        </h2>
        {href && <Link to={href}>See all</Link>}
      </div>
      <div className="shelf" data-row>
        {children}
      </div>
    </section>
  )
}
