import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Loader2, RotateCw, ScrollText, Square, Trash2, XCircle, CircleSlash } from 'lucide-react'
import { Fragment, useState } from 'react'
import DocsLink from '../components/DocsLink'
import { Button, Empty, Modal, Progress, Spinner, errorText, useToast } from '../components/ui'
import { TagPill } from '../lantern/controls'
import { useRoom } from '../lantern/Room'
import { api, del, jobTitle, post } from '../lib/api'
import type { Job, JobsResponse } from '@shared/api'
import { ago, pct, capitalize } from '../lib/format'
import { bytes } from '@shared/format'
import { useGames, useJobs } from '../lib/queries'

const icon = {
  queued: <Clock />,
  running: <Loader2 className="animate-spin" />,
  done: <Check />,
  failed: <XCircle />,
  cancelled: <CircleSlash />,
  interrupted: <CircleSlash />,
}
const iconClass: Record<Job['status'], string> = {
  queued: '',
  running: 'run',
  done: 'ok',
  failed: 'bad',
  cancelled: '',
  interrupted: 'bad',
}

function dayGroup(job: Job): string {
  if (job.status === 'running' || job.status === 'queued') return 'Running'
  const date = new Date(job.finishedAt ?? job.createdAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Earlier today'
  today.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

const STATUS_LABEL: Record<Job['status'], string> = {
  queued: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
}

function resultText(j: Job): string | null {
  const r = j.result
  if (!r) return null
  if (j.type === 'import' && r.size) {
    const opt = r.images?.converted ? ` · ${r.images.converted.toLocaleString()} images ${bytes(r.images.before)} → ${bytes(r.images.after)}` : ''
    return `Installed ${bytes(r.size)}${opt}`
  }
  if (j.type === 'optimize') return `${r.converted?.toLocaleString?.() ?? 0} images, ${bytes(r.before)} → ${bytes(r.after)}`
  if (j.type === 'analyze') return [r.saveDir && `Saves to ${r.saveDir}`, r.screen && `${r.screen[0]}×${r.screen[1]}`].filter(Boolean).join(' · ') || null
  if (j.type === 'hash-archive') return r.recipe ? `Matches recipe ${r.recipe}` : 'No matching recipe'
  return null
}

export default function Activity() {
  useJobs()
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['jobs', 'activity'], initialPageParam: 0,
    queryFn: ({ pageParam }) => api<JobsResponse>(`/api/jobs?limit=20&offset=${pageParam}`),
    getNextPageParam: (last, pages) => { const loaded = pages.reduce((n, p) => n + p.jobs.length, 0); return loaded < last.total ? loaded : undefined },
    refetchInterval: 5000,
  })
  const { data: games } = useGames()
  const qc = useQueryClient()
  const toast = useToast()
  const [logFor, setLogFor] = useState<Job | null>(null)
  useRoom({ game: null, quiet: true })
  if (isLoading) return <Spinner />
  const attempts = new Map<string, { job: Job; count: number }>()
  const seen = new Set<string>()
  for (const job of data?.pages.flatMap((p) => p.jobs) ?? []) {
    if (seen.has(job.id)) continue
    seen.add(job.id)
    const key = JSON.stringify([job.type, job.game, job.params])
    const previous = attempts.get(key)
    if (previous) previous.count++
    else attempts.set(key, { job, count: 1 })
  }
  const jobs = [...attempts.values()]
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  return (
    <div>
      <div className="row between wrap" style={{ gap: 12 }}>
        <div>
          <h1 className="h1">Activity</h1>
          <p className="lead" style={{ marginTop: 6 }}>Installs, updates and optimizations. One job runs at a time.</p>
        </div>
        <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => act(() => del('/api/jobs'))}>
          Clear finished
        </Button>
      </div>
      {!jobs.length ? (
        <div style={{ marginTop: 18 }}>
          <Empty title="Nothing happening">Installs, updates and optimizations show up here.</Empty>
        </div>
      ) : (
        jobs.map(({ job: j, count }, index) => {
          const active = j.status === 'running' || j.status === 'queued'
          const res = resultText(j)
          return (
            <Fragment key={j.id}>
              {(index === 0 || dayGroup(jobs[index - 1]!.job) !== dayGroup(j)) && <div className="day">{dayGroup(j)}</div>}
              <div className="rows">
                <div className="r stack-ph">
                  <div className={`ic ${iconClass[j.status]}`}>{icon[j.status]}</div>
                  <div className="grow">
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span className="t">{jobTitle(j, games ?? [])}</span>
                      {(count > 1 || j.status === 'failed' || j.status === 'interrupted') && <TagPill>{count} attempt{count === 1 ? '' : 's'}</TagPill>}
                      {j.status === 'queued' && <TagPill>Queued</TagPill>}
                    </div>
                    <div className="m">
                      {j.status === 'running' ? (
                        <>
                          {j.stage}
                          {j.message ? ` · ${j.message}` : ''}
                        </>
                      ) : j.status === 'failed' || j.status === 'interrupted' ? (
                        <span className="red">{j.error} <DocsLink path="troubleshooting/">Troubleshooting</DocsLink></span>
                      ) : (
                        <>
                          {STATUS_LABEL[j.status]} · {capitalize(ago(j.finishedAt ?? j.createdAt))}
                          {res ? ` · ${res}` : ''}
                        </>
                      )}
                    </div>
                    {j.status === 'running' && <Progress value={j.progress} className="thin" />}
                  </div>
                  {j.status === 'running' && <span className="tnum muted-2 small">{pct(j.progress)}</span>}
                  <div className="end">
                    <Button size="sm" variant="ghost" icon={<ScrollText />} onClick={() => setLogFor(j)}>
                      Log
                    </Button>
                    {active && (
                      <Button size="sm" variant="ghost" icon={<Square />} onClick={() => act(() => post(`/api/jobs/${j.id}/cancel`))}>
                        Cancel
                      </Button>
                    )}
                    {(j.status === 'failed' || j.status === 'interrupted' || j.status === 'cancelled') && (
                      <Button size="sm" icon={<RotateCw />} onClick={() => act(() => post(`/api/jobs/${j.id}/retry`))}>
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Fragment>
          )
        })
      )}
      {hasNextPage && (
        <div className="center" style={{ marginTop: 18 }}>
          <Button loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>Show more</Button>
        </div>
      )}
      {logFor && <LogDialog job={logFor} onClose={() => setLogFor(null)} />}
    </div>
  )
}

function LogDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['job-log', job.id],
    queryFn: () => api<string>(`/api/jobs/${job.id}/log`),
    refetchInterval: job.status === 'running' ? 2000 : false,
  })
  return (
    <Modal open onClose={onClose} title="Job log" wide>
      <pre style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: 12, background: 'rgba(0,0,0,.4)', padding: 16, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.6, color: 'var(--fg-2)' }}>{data || 'No output yet.'}</pre>
    </Modal>
  )
}
