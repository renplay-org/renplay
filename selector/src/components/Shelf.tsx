import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

export default function Shelf({ title, count, href, children }: { title: string; count: number; href: string; children: ReactNode }) {
  if (!count) return null
  return <section className="mb-8"><div className="mb-4 flex items-center gap-3"><h2 className="text-lg font-semibold text-white">{title} <span className="text-sm font-normal text-zinc-500">{count}</span></h2><Link className="ml-auto inline-flex min-h-11 items-center text-sm text-zinc-400" to={href}>See all →</Link></div><div className="flex snap-x gap-4 overflow-x-auto pb-3 [&>*]:w-40 [&>*]:shrink-0 [&>*]:snap-start sm:grid sm:grid-cols-4 sm:[&>*]:w-auto lg:grid-cols-7">{children}</div></section>
}
