import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

/** A shelf: tiles scrolling sideways with snap, one row. Wide tiles for Up next. Empty shelves are not shown. */
export default function Shelf({ title, count, href, wide, children }: { title: string; count: number; href?: string; wide?: boolean; children: ReactNode }) {
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
      <div className={`shelf ${wide ? 'wide' : ''}`} data-row>
        {children}
      </div>
    </section>
  )
}
