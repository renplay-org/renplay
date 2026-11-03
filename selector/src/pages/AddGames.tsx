import { useQueryClient } from '@tanstack/react-query'
import { CloudUpload, ExternalLink, FileArchive, Library, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Cover } from '../components/GameCard'
import { Badge, Button, Confirm, Modal, Progress, Spinner, Switch, Tabs, cx, errorText, useToast } from '../components/ui'
import { del, post, type Archive, type ArchiveInfo, type Job, type Recipe } from '../lib/api'
import { ago, bytes, pct } from '../lib/format'
import { recipeLinks } from '../lib/links'
import { useArchives, useCatalog, useGames, useJobs, useSystem } from '../lib/queries'
import { uploadArchive, type UploadHandle } from '../lib/upload'

type Tab = 'downloads' | 'catalog'

const STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'neutral' }> = {
  verified: { label: 'Verified', tone: 'green' },
  playable: { label: 'Known issues', tone: 'amber' },
  broken: { label: 'Broken', tone: 'red' },
  untested: { label: 'Untested', tone: 'neutral' },
}

const REQUEST_URL = 'https://renplay-web.github.io/catalog.html#request'

export default function AddGames() {
  const [tab, setTab] = useState<Tab>('downloads')
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Add games</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">Install a Ren’Py game from its PC download. Renplay builds it for the browser on the server.</p>
      </div>
      <div className="mb-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'downloads', label: <><FileArchive className="size-4" /> Downloads</> },
            { id: 'catalog', label: <><Library className="size-4" /> Catalog</> },
          ]}
        />
      </div>
      {tab === 'downloads' ? <Downloads /> : <CatalogTab />}
    </div>
  )
}

/** The install job of an archive, while it is queued or running. */
function activeJob(jobs: Job[] | undefined, a: Archive): Job | undefined {
  return jobs?.find((j) => j.type === 'import' && j.params?.source?.path === a.path && (j.status === 'queued' || j.status === 'running'))
}

function Downloads() {
  const { data, isLoading, refetch, isFetching } = useArchives()
  const { data: sys } = useSystem()
  const { data: jobs } = useJobs()
  const [installing, setInstalling] = useState<Archive | null>(null)
  if (isLoading) return <Spinner />
  const archives = data?.archives ?? []
  const job = (a: Archive) => activeJob(jobs?.jobs, a)
  const ready = archives.filter((a) => !a.installedAs || job(a))
  const installed = archives.filter((a) => a.installedAs && !job(a))
  const refresh = (
    <Button size="sm" variant="ghost" icon={<RefreshCw className={cx('size-4', isFetching && 'animate-spin')} />} onClick={() => void refetch()}>
      Refresh
    </Button>
  )
  return (
    <div className="space-y-8">
      <UploadZone dir={data?.dir ?? sys?.paths.archives} />
      {!archives.length ? (
        <div className="flex items-center justify-between gap-4 text-sm text-zinc-500">
          <span>Downloads you add show up here.</span>
          {refresh}
        </div>
      ) : (
        <>
          {ready.length > 0 && (
            <Section title="Ready to install" action={refresh}>
              {ready.map((a) => (
                <ArchiveRow key={a.path} archive={a} job={job(a)} onInstall={() => setInstalling(a)} />
              ))}
            </Section>
          )}
          {installed.length > 0 && (
            <Section title="Installed" action={ready.length ? undefined : refresh}>
              {installed.map((a) => (
                <ArchiveRow key={a.path} archive={a} onInstall={() => setInstalling(a)} />
              ))}
            </Section>
          )}
        </>
      )}
      {sys && (
        <p className="text-xs text-zinc-500">
          {sys.deleteArchives ? 'Downloads are deleted once they install, to save space. Add one again to reinstall its game.' : 'Downloads stay here after they install, so you can reinstall their games.'}
        </p>
      )}
      {installing && <InstallDialog archive={installing} deletes={!!sys?.deleteArchives} onClose={() => setInstalling(null)} />}
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex min-h-9 items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-zinc-300">{title}</h2>
        {action}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

function ArchiveRow({ archive: a, job, onInstall }: { archive: Archive; job?: Job; onInstall: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: games } = useGames()
  const [info, setInfo] = useState<ArchiveInfo | null>(a.info)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Only zips can be looked into without unpacking them.
  useEffect(() => {
    if (a.info || !/\.zip$/i.test(a.name)) return
    post<{ info: ArchiveInfo }>('/api/archives/inspect', { path: a.path })
      .then((r) => setInfo(r.info))
      .catch(() => {})
  }, [a.path, a.info, a.name])
  const title = a.recipe?.title ?? info?.title ?? a.name
  const version = info?.version ?? a.recipe?.version
  // How well it works matters before installing, not after.
  const status = a.recipe && !a.installedAs ? STATUS[a.recipe.status] : undefined
  const updates = !a.installedAs && a.existingGame ? (games?.find((g) => g.id === a.existingGame)?.title ?? a.existingGame) : null
  const renpy = (info?.renpyVersion ?? games?.find((g) => g.id === a.installedAs)?.renpyVersion)?.split('.').slice(0, 3).join('.')
  const unknown = info?.type === 'zip' && !info.layout
  const meta = [bytes(a.size), renpy && `Ren’Py ${renpy}`, `Added ${ago(a.mtime)}`, title !== a.name && a.name].filter(Boolean).join(' · ')
  const actions = job ? (
    <Link to="/activity" className="inline-flex h-9 items-center rounded-xl px-3 text-sm text-zinc-400 hover:bg-white/10 hover:text-white">
      Show log
    </Link>
  ) : (
    <>
      <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)} aria-label={`Delete ${a.name}`} title="Delete download" />
      <Button size="sm" variant={a.installedAs ? 'secondary' : 'primary'} onClick={onInstall}>
        {a.installedAs ? 'Reinstall' : updates ? 'Update' : 'Install'}
      </Button>
    </>
  )
  return (
    <div className="flex gap-3 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07] sm:items-center sm:gap-4">
      {a.recipe?.cover ? (
        <Cover game={{ title, cover: a.recipe.cover, nsfw: a.recipe.nsfw }} className="aspect-[63/50] w-20 shrink-0 self-start rounded-xl sm:w-24 sm:self-center" rounded={false} />
      ) : (
        <div className="flex aspect-[63/50] w-20 shrink-0 items-center justify-center self-start rounded-xl bg-white/[0.05] text-zinc-500 sm:w-24 sm:self-center">
          <FileArchive className="size-6" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-zinc-100">{title}</span>
          {version && <Badge className="shrink-0">{version}</Badge>}
        </div>
        <div className="mt-0.5 line-clamp-2 break-words text-xs text-zinc-500">{meta}</div>
        {(status || updates || unknown) && !job && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {status && <Badge tone={status.tone}>{status.label}</Badge>}
            {updates && <Badge tone="accent">Update for {updates}</Badge>}
            {unknown && <Badge tone="amber">No Ren’Py game found</Badge>}
          </div>
        )}
        {job && <JobLine job={job} />}
        <div className="-ml-2.5 mt-2 flex flex-wrap items-center gap-1 sm:hidden">{actions}</div>
      </div>
      <div className="hidden shrink-0 items-center gap-1 sm:flex">{actions}</div>
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="Delete this download?"
        confirmLabel="Delete"
        onConfirm={async () => {
          setConfirmDelete(false)
          try {
            await del(`/api/archives?path=${encodeURIComponent(a.path)}`)
            void qc.invalidateQueries({ queryKey: ['archives'] })
          } catch (e) {
            toast(errorText(e), 'error')
          }
        }}
      >
        Deletes {a.name} ({bytes(a.size)}) from the server.{a.installedAs ? ' The installed game keeps working, but you need the download again to reinstall it.' : ''}
      </Confirm>
    </div>
  )
}

function JobLine({ job }: { job: Job }) {
  if (job.status === 'queued') return <div className="mt-2 text-xs text-zinc-400">Waiting for the install before it</div>
  return (
    <div className="mt-2.5 max-w-md">
      <div className="mb-1.5 flex justify-between gap-3 text-xs text-zinc-400">
        <span className="truncate">{job.stage || 'Installing'}</span>
        <span className="shrink-0 tabular-nums">{pct(job.progress)}</span>
      </div>
      <Progress value={job.progress} />
    </div>
  )
}

function InstallDialog({ archive, deletes, onClose }: { archive: Archive; deletes: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: games } = useGames()
  const target = archive.installedAs ?? archive.existingGame ?? undefined
  const targetGame = games?.find((g) => g.id === target)
  const title = archive.recipe?.title ?? archive.info?.title ?? archive.name
  const [reapply, setReapply] = useState(true)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      onClose={onClose}
      title={archive.installedAs ? `Reinstall ${targetGame?.title ?? title}` : target ? `Update ${targetGame?.title ?? target}` : `Install ${title}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await post('/api/imports', {
                  source: { kind: 'archive', path: archive.path },
                  game: target,
                  reapplyMods: reapply,
                  recipeId: archive.recipe?.id,
                })
                toast('Installing. You can leave this page.', 'success')
                void qc.invalidateQueries({ queryKey: ['jobs'] })
                void qc.invalidateQueries({ queryKey: ['games'] })
                onClose()
              } catch (e) {
                toast(errorText(e), 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            {archive.installedAs ? 'Reinstall' : target ? 'Update' : 'Install'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-zinc-400">
          From <span className="text-zinc-200">{archive.name}</span> ({bytes(archive.size)}). It installs on the server; big games take a few minutes, and you can leave this page.
          {deletes ? ' The download is deleted once the game is installed.' : ''}
        </p>
        {target && (
          <div className="rounded-xl bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-100 ring-1 ring-inset ring-amber-500/20">
            Replaces the installed version. Saves stay where they are.
          </div>
        )}
        {targetGame && targetGame.mods.files > 0 && (
          <Switch checked={reapply} onChange={setReapply} label={`Re-apply my mods (${targetGame.mods.files} changes)`} hint="Mods made for the old version may not work with the new one. Off moves them aside." />
        )}
      </div>
    </Modal>
  )
}

function UploadZone({ dir }: { dir?: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [drag, setDrag] = useState(false)
  const [up, setUp] = useState<{ file: File; sent: number; handle: UploadHandle; paused: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const start = (file: File) => {
    const handle = uploadArchive(file, (sent) => setUp((u) => (u ? { ...u, sent } : u)))
    setUp({ file, sent: 0, handle, paused: false })
    handle.promise
      .then(() => {
        toast(`${file.name} uploaded`, 'success')
        void qc.invalidateQueries({ queryKey: ['archives'] })
        setUp(null)
      })
      .catch((e) => {
        if (errorText(e) !== 'Upload cancelled') toast(errorText(e), 'error')
        setUp(null)
      })
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        const f = e.dataTransfer.files[0]
        if (f && !up) start(f)
      }}
      className={cx('rounded-2xl border border-dashed p-4 transition-colors sm:p-5', drag ? 'border-accent-400 bg-accent-500/[0.06]' : 'border-white/15 bg-white/[0.02]')}
    >
      {up ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate font-medium text-zinc-100">{up.file.name}</span>
              <span className="shrink-0 tabular-nums text-zinc-400">{pct(up.sent / up.file.size)}</span>
            </div>
            <Progress className="mt-2" value={up.sent / up.file.size} />
            <div className="mt-1.5 text-xs text-zinc-500">
              {bytes(up.sent)} of {bytes(up.file.size)}. If it stops, pick the same file again to continue.
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {up.paused ? (
              <Button size="sm" icon={<Play className="size-4" />} onClick={() => (up.handle.resume(), setUp({ ...up, paused: false }))}>
                Resume
              </Button>
            ) : (
              <Button size="sm" icon={<Pause className="size-4" />} onClick={() => (up.handle.pause(), setUp({ ...up, paused: true }))}>
                Pause
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => up.handle.cancel()}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <div className="flex min-w-0 flex-1 gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-300">
              <CloudUpload className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-zinc-100">
                Upload a game’s PC download<span className="hidden sm:inline">, or drop it here</span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                A .zip, .7z or .rar of any size. On the server, you can also copy it into{' '}
                <code className="break-all rounded bg-white/[0.06] px-1 py-0.5 text-[11px] text-zinc-300">{dir ?? 'the archives folder'}</code>.
              </p>
            </div>
          </div>
          <input ref={inputRef} type="file" accept=".zip,.7z,.rar,.tar,.tgz" className="hidden" onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
          <Button className="shrink-0" variant="primary" icon={<CloudUpload className="size-4" />} onClick={() => inputRef.current?.click()}>
            Choose file
          </Button>
        </div>
      )}
    </div>
  )
}

function CatalogTab() {
  const { data, isLoading, refetch } = useCatalog()
  const qc = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  if (isLoading) return <Spinner />
  const games = data?.games ?? []
  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-zinc-400">Games tested in Renplay. Get one from its developer and add the download: Renplay recognizes it and uses the right settings.</p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            loading={refreshing}
            icon={<RefreshCw className="size-4" />}
            onClick={async () => {
              setRefreshing(true)
              try {
                await post('/api/catalog/refresh')
                await refetch()
                void qc.invalidateQueries({ queryKey: ['archives'] })
              } finally {
                setRefreshing(false)
              }
            }}
          >
            Refresh
          </Button>
          <a href={REQUEST_URL} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm text-zinc-300 hover:bg-white/10 hover:text-white">
            Request a game <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>
      {data?.status.errors.length ? <p className="mb-4 text-xs text-amber-300">Could not reach the catalog: {data.status.errors.join('; ')}</p> : null}
      {!games.length ? (
        <p className="text-sm text-zinc-500">No games in the catalog yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {games.map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeCard({ recipe: r }: { recipe: Recipe }) {
  const latest = r.releases[0]
  const status = latest ? STATUS[latest.status] : undefined
  return (
    <div className="flex min-w-0 gap-3 rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.07] sm:gap-4">
      <Cover game={{ title: r.title, cover: typeof r.cover === 'string' ? r.cover : null, nsfw: r.nsfw }} rounded={false} className="aspect-[63/50] w-28 shrink-0 self-start rounded-xl sm:w-36" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-white">{r.title}</div>
        {r.developer && <div className="truncate text-xs text-zinc-400">{r.developer}</div>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {latest && <Badge>{latest.version}</Badge>}
          {status && <Badge tone={status.tone}>{status.label}</Badge>}
          {r.local && (
            <Link to={`/game/${r.local.id}`}>
              <Badge tone="accent">In your library</Badge>
            </Link>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
          {recipeLinks(r.links).map(([k, label, url]) => (
            <a key={k} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white">
              {label} <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
        {latest?.archives?.[0] && <p className="mt-2 truncate text-[11px] text-zinc-500">Download: {latest.archives.map((a) => a.name).join(' or ')}</p>}
      </div>
    </div>
  )
}
