import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleSlash, Clock, Loader2, RotateCw, ScrollText, Square, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Empty, Modal, Progress, Spinner, errorText, useToast } from '../components/ui'
import { api, del, jobTitle, post, type Job } from '../lib/api'
import { ago, bytes, pct } from '../lib/format'
import { useGames, useJobs } from '../lib/queries'

const icon = {
  queued: <Clock className="size-4 text-zinc-400" />,
  running: <Loader2 className="size-4 animate-spin text-accent-300" />,
  done: <CheckCircle2 className="size-4 text-emerald-400" />,
  failed: <XCircle className="size-4 text-red-400" />,
  cancelled: <CircleSlash className="size-4 text-zinc-500" />,
  interrupted: <CircleSlash className="size-4 text-amber-400" />,
}

function resultText(j: Job): string | null {
  const r = j.result
  if (!r) return null
  if (j.type === 'import' && r.size) {
    const opt = r.optimized?.images ? ` · ${r.optimized.images.toLocaleString()} images ${bytes(r.optimized.before)} → ${bytes(r.optimized.after)}` : ''
    return `Installed ${bytes(r.size)}${opt}`
  }
  if (j.type === 'optimize') return `${r.converted?.toLocaleString?.() ?? 0} images, ${bytes(r.before)} → ${bytes(r.after)}`
  if (j.type === 'analyze') return [r.saveDir && `saves to ${r.saveDir}`, r.screen && `${r.screen[0]}×${r.screen[1]}`].filter(Boolean).join(' · ') || null
  if (j.type === 'hash-archive') return r.recipe ? `Matches recipe ${r.recipe}` : 'No matching recipe'
  return null
}

export default function Activity() {
  const { data, isLoading } = useJobs()
  const { data: games } = useGames()
  const qc = useQueryClient()
  const toast = useToast()
  const [logFor, setLogFor] = useState<Job | null>(null)
  if (isLoading) return <Spinner />
  const jobs = data?.jobs ?? []
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Activity</h1>
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => act(() => del('/api/jobs'))}>
          Clear finished
        </Button>
      </div>
      {!jobs.length ? (
        <Empty title="Nothing happening">Installs, updates and optimizations show up here.</Empty>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => {
            const active = j.status === 'running' || j.status === 'queued'
            const res = resultText(j)
            return (
              <div key={j.id} className="rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.07]">
                <div className="flex items-center gap-3">
                  {icon[j.status]}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-zinc-100">{jobTitle(j, games ?? [])}</span>
                      {j.slug && games?.some((g) => g.slug === j.slug) && (
                        <Link to={`/game/${j.slug}`} className="text-xs text-zinc-500 hover:text-zinc-300">
                          open →
                        </Link>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500">
                      {j.status === 'running' ? (
                        <>
                          {j.stage}
                          {j.message ? ` · ${j.message}` : ''}
                        </>
                      ) : j.status === 'failed' || j.status === 'interrupted' ? (
                        <span className="text-red-300">{j.error}</span>
                      ) : (
                        <>
                          {j.status === 'queued' ? 'Waiting' : j.status} · {ago(j.finishedAt ?? j.createdAt)}
                          {res ? ` · ${res}` : ''}
                        </>
                      )}
                    </div>
                  </div>
                  {j.status === 'running' && <span className="text-sm tabular-nums text-zinc-300">{pct(j.progress)}</span>}
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={<ScrollText className="size-4" />} onClick={() => setLogFor(j)}>
                      Log
                    </Button>
                    {active && (
                      <Button size="sm" variant="ghost" icon={<Square className="size-4" />} onClick={() => act(() => post(`/api/jobs/${j.id}/cancel`))}>
                        Cancel
                      </Button>
                    )}
                    {(j.status === 'failed' || j.status === 'interrupted' || j.status === 'cancelled') && (
                      <Button size="sm" icon={<RotateCw className="size-4" />} onClick={() => act(() => post(`/api/jobs/${j.id}/retry`))}>
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
                {j.status === 'running' && <Progress value={j.progress} className="mt-3" />}
                {j.status === 'queued' && <Badge className="mt-3">Queued</Badge>}
              </div>
            )
          })}
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
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-black/40 p-4 font-mono text-[12px] leading-relaxed text-zinc-300">{data || 'No output yet.'}</pre>
    </Modal>
  )
}
