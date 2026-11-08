import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode } from 'react'
import { errorText, useToast } from '../../lantern/ui'
import { SourceLabel } from '../../lantern/controls'
import type { SystemInfo } from '@shared/api'

export function Setting({ title, hint, source, inline, children }: { title: string; hint?: ReactNode; source?: ReactNode; inline?: boolean; children: ReactNode }) {
  return (
    <div className={`setting ${inline ? 'inline' : ''}`}>
      <div className="l">
        <div className="t">{title}</div>
        {hint && <div className="d">{hint}</div>}
        {source}
      </div>
      <div className="c">{children}</div>
    </div>
  )
}

/** Where a server setting comes from: its variable on the server, or the default. */
export function setBy(sys: SystemInfo | undefined, variable: string) {
  return sys?.setBy?.[variable] === 'server' ? <SourceLabel kind="server" label={variable} /> : <SourceLabel kind="def" />
}


/** Runs a change, says that it worked or why not, and refreshes what the page shows. */
export function useRun() {
  const qc = useQueryClient()
  const toast = useToast()
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast(ok, 'success')
      void qc.invalidateQueries()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
}
