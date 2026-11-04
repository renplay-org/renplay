import type { ReactNode } from 'react'

/** Stable website redirects keep help links independent of where the docs are hosted. */
export default function DocsLink({ path = '', children = 'Docs' }: { path?: string; children?: ReactNode }) {
  return <a className="inline-flex min-h-11 items-center text-sm text-accent-300 hover:underline" href={`https://renplay.org/docs/${path}`} target="_blank" rel="noreferrer">{children} ↗</a>
}
