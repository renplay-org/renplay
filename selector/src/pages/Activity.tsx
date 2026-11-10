import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Clock, CircleSlash, ChevronsUp, Loader2, Pause, Play, RotateCw, ScrollText, Square, Trash2, XCircle } from 'lucide-react'
import { Fragment, useState } from 'react'
import DocsLink from '../components/DocsLink'
import { Empty, Spinner, errorText, useToast } from '../lantern/ui'
import { TagPill, Bar, IconBtn, Pill } from '../lantern/controls'
import { useRoom } from '../lantern/Room'
import { api, del, post } from '../lib/api'
import { jobTitle } from '../lib/format'
import type { Job, JobsResponse } from '@shared/api'
import { ago, pct, capitalize } from '../lib/format'
import { bytes } from '@shared/format'
import { useGames, useJobs } from '../lib/queries'
import Sheet from '../lantern/Sheet'
import BackLink from '../components/BackLink'

const icon = {
  queued: <Clock />,
  paused: <Pause />,
  running: <Loader2 className="animate-spin" />,
  done: <Check />,
  failed: <XCircle />,
  cancelled: <CircleSlash />,
  interrupted: <CircleSlash />,
}
const iconClass: Record<Job['status'], string> = {
  queued: '',
  paused: '',
  running: 'run',
  done: 'ok',
  failed: 'bad',
  cancelled: '',
  interrupted: 'bad',
}

function dayGroup(job: Job): string {
  if (job.status === 'running') return 'Running'
  if (job.status === 'queued' || job.status === 'paused') return 'Waiting'
  const date = new Date(job.finishedAt ?? job.createdAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Earlier today'
  today.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

const STATUS_LABEL: Record<Job['status'], string> = {
  queued: 'Waiting',
  paused: 'Paused',
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
  const jobs = data?.pages.flatMap((p) => p.jobs).filter((job, i, all) => all.findIndex((other) => other.id === job.id) === i) ?? []
  // The jobs waiting, in the order they run: where a job can still move.
  const waiting = jobs.filter((j) => j.status === 'queued' || j.status === 'paused')
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
      <BackLink to="/" />
      <div className="row between wrap" style={{ gap: 12 }}>
        <div>
          <h1 className="h1">Activity</h1>
          <p className="lead" style={{ marginTop: 6 }}>Installs, updates and mod builds. One job runs at a time.</p>
        </div>
        <Pill size="sm" variant="q" icon={<Trash2 />} onClick={() => act(() => del('/api/jobs'))}>
          Clear finished
        </Pill>
      </div>
      {!jobs.length ? (
        <div style={{ marginTop: 18 }}>
          <Empty title="Nothing happening">Installs, updates and mod builds show up here.</Empty>
        </div>
      ) : (
        jobs.map((j, index) => {
          const active = j.status === 'running' || j.status === 'queued' || j.status === 'paused'
          const place = waiting.indexOf(j)
          const res = resultText(j)
          return (
            <Fragment key={j.id}>
              {(index === 0 || dayGroup(jobs[index - 1]!) !== dayGroup(j)) && <div className="day">{dayGroup(j)}</div>}
              <div className="rows">
                <div className="r stack-ph">
                  <div className={`ic ${iconClass[j.status]}`}>{icon[j.status]}</div>
                  <div className="grow">
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span className="t">{jobTitle(j, games ?? [])}</span>
                      {j.attempts > 1 && <TagPill>{j.attempts} attempts</TagPill>}
                      {j.status === 'queued' && <TagPill>{j === waiting.find((w) => w.status === 'queued') ? 'Runs next' : 'Queued'}</TagPill>}
                      {j.status === 'paused' && <TagPill tone="amber">Paused</TagPill>}
                    </div>
                    <div className="m">
                      {j.status === 'running' ? (
                        <>
                          {j.stage}
                          {j.message ? ` · ${j.message}` : ''}
                        </>
                      ) : j.status === 'paused' ? (
                        <>{j.stage === 'Paused' ? (j.type === 'import' ? 'Resuming starts again from the archive' : 'Resuming starts it again') : 'Skipped until you resume it'}</>
                      ) : j.status === 'failed' || j.status === 'interrupted' ? (
                        <span className="red">{j.error} <DocsLink path="troubleshooting/">Troubleshooting</DocsLink></span>
                      ) : (
                        <>
                          {STATUS_LABEL[j.status]} · {capitalize(ago(j.finishedAt ?? j.createdAt))}
                          {res ? ` · ${res}` : ''}
                        </>
                      )}
                    </div>
                    {j.status === 'running' && <Bar value={j.progress} thin />}
                  </div>
                  {j.status === 'running' && <span className="tnum muted-2 small">{pct(j.progress)}</span>}
                  <div className="end">
                    <Pill size="sm" variant="q" icon={<ScrollText />} onClick={() => setLogFor(j)}>
                      Log
                    </Pill>
                    {place >= 0 && (
                      <>
                        <IconBtn label={`Move ${jobTitle(j, games ?? [])} up`} disabled={place === 0} onClick={() => act(() => post(`/api/jobs/${j.id}/move`, { to: 'up' }))}>
                          <ArrowUp />
                        </IconBtn>
                        <IconBtn label={`Move ${jobTitle(j, games ?? [])} down`} disabled={place === waiting.length - 1} onClick={() => act(() => post(`/api/jobs/${j.id}/move`, { to: 'down' }))}>
                          <ArrowDown />
                        </IconBtn>
                        <Pill size="sm" variant="q" icon={<ChevronsUp />} disabled={place === 0} onClick={() => act(() => post(`/api/jobs/${j.id}/move`, { to: 'first' }))}>
                          Do next
                        </Pill>
                      </>
                    )}
                    {j.status === 'paused' ? (
                      <Pill size="sm" icon={<Play />} onClick={() => act(() => post(`/api/jobs/${j.id}/resume`))}>
                        Resume
                      </Pill>
                    ) : (
                      (j.status === 'running' || j.status === 'queued') && (
                        <Pill size="sm" variant="q" icon={<Pause />} onClick={() => act(() => post(`/api/jobs/${j.id}/pause`))}>
                          Pause
                        </Pill>
                      )
                    )}
                    {active && (
                      <Pill size="sm" variant="q" icon={<Square />} onClick={() => act(() => post(`/api/jobs/${j.id}/cancel`))}>
                        Cancel
                      </Pill>
                    )}
                    {(j.status === 'failed' || j.status === 'interrupted' || j.status === 'cancelled') && (
                      <Pill size="sm" icon={<RotateCw />} onClick={() => act(() => post(`/api/jobs/${j.id}/retry`))}>
                        Retry
                      </Pill>
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
          <Pill loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>Show more</Pill>
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
    <Sheet open onClose={onClose} title="Job log" wide>
      <pre style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: 12, background: 'rgba(0,0,0,.4)', padding: 16, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.6, color: 'var(--fg-2)' }}>{data || 'No output yet.'}</pre>
    </Sheet>
  )
}
