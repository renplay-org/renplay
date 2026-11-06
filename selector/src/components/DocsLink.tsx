import type { ReactNode } from 'react'

/** Stable website redirects keep help links independent of where the docs are hosted. */
export default function DocsLink({ path = '', children = 'Docs' }: { path?: string; children?: ReactNode }) {
  return (
    <a className="link small" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }} href={`https://renplay.org/docs/${path}`} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  )
}
