import { useQueryClient } from '@tanstack/react-query'
import { CloudUpload, ExternalLink, FileArchive, MoreHorizontal, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Sheet from '../components/Sheet'
import DocsLink from '../components/DocsLink'
import SegmentedControl from '../components/SegmentedControl'
import { Cover } from '../components/GameCard'
import TagFilters from '../components/TagFilters'
import { gameTags, matchesSearch, tagChips } from '../lib/tags'
import RecipeCard from '../components/RecipeCard'
import { Badge, BetaBadge, Button, Confirm, Modal, Progress, Spinner, Switch, MenuItem, cx, errorText, useToast } from '../components/ui'
import { del, post, type Archive, type ArchiveInfo, type Job } from '../lib/api'
import { ago, bytes, pct } from '../lib/format'
import { useArchives, useCatalog, useGames, useJobs, useSystem } from '../lib/queries'
import { uploadArchive, type UploadHandle } from '../lib/upload'

// A game in the catalog works; only a release marked broken is worth a word.
const BROKEN = 'Does not work'

const REQUEST_URL = 'https://renplay.org/catalog/request'

export default function AddGames() {
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Add games</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">Install a game from its PC download: a Ren’Py game, or an HTML game such as a Twine story. Renplay builds it for the browser on the server.</p>
      </div>
      <Downloads />
      <section className="mt-12"><h2 className="mb-5 text-xl font-semibold text-white">Catalog</h2><CatalogTab /></section>
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
  // Games of engines this version cannot install are listed apart, with the reason.
  const other = (a: Archive) => !a.installedAs && !job(a) && a.info?.engine?.installable === false
  const ready = archives.filter((a) => (!a.installedAs || job(a)) && !other(a))
  const installed = archives.filter((a) => a.installedAs && !job(a))
  const others = archives.filter(other)
  const refresh = (
    <Button size="sm" variant="ghost" icon={<RefreshCw className={cx('size-4', isFetching && 'animate-spin')} />} onClick={() => void refetch()}>
      Refresh
    </Button>
  )
  return (
    <div className="space-y-8">
      <UploadZone />
      {jobs?.jobs.some((j) => j.type === 'import' && (j.status === 'failed' || j.status === 'interrupted')) && <p className="text-sm text-zinc-400">An install did not finish. <Link className="text-accent-300" to="/activity">Open Activity</Link> for its log, or read <DocsLink path="troubleshooting/">Troubleshooting</DocsLink>.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold text-white">On the server</h2><code className="break-all text-xs text-zinc-500">{data?.dir ?? sys?.paths.archives}</code></div>
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
          {others.length > 0 && (
            <details><summary className="min-h-11 cursor-pointer text-sm text-zinc-400">Other engines ({others.length})</summary><Section title="Other engines" action={ready.length || installed.length ? undefined : refresh}>
              {others.map((a) => (
                <ArchiveRow key={a.path} archive={a} onInstall={() => setInstalling(a)} />
              ))}
            </Section></details>
          )}
        </>
      )}
      {sys && (
        <p className="text-xs text-zinc-500">
          {sys.keepDownloads ? 'Downloads stay here after they install, so you can reinstall their games.' : 'Uploads through Renplay are deleted after a successful install. Files copied in stay here. Add a deleted download again to reinstall.'}
        </p>
      )}
      {installing && <InstallDialog archive={installing} deletes={sys ? !sys.keepDownloads : false} onClose={() => setInstalling(null)} />}
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
      .then((r) => {
        setInfo(r.info)
        // So the row moves to its section.
        void qc.invalidateQueries({ queryKey: ['archives'] })
      })
      .catch(() => {})
  }, [a.path, a.info, a.name, qc])
  const title = a.recipe?.title ?? info?.title ?? a.name
  const version = a.recipe?.version ?? info?.version
  const broken = !a.installedAs && a.recipe?.status === 'broken'
  const existing = games?.find((g) => g.id === a.existingGame)
  const sameRelease = !!existing && !!version && (existing.version === version || existing.detectedVersion === version)
  const reinstall = !!a.installedAs || sameRelease
  const updates = !reinstall && a.existingGame ? (existing?.title ?? a.existingGame) : null
  const renpy = (info?.renpyVersion ?? games?.find((g) => g.id === a.installedAs)?.renpyVersion)?.split('.').slice(0, 3).join('.')
  const engine = info?.engine
  const foreign = engine && engine.family !== 'renpy' ? engine : null
  const unknown = info?.type === 'zip' && !info.layout && !engine
  const blocked = !!a.blocked || (!a.installedAs && engine?.installable === false)
  const madeWith = foreign ? foreign.label : renpy && `Ren’Py ${renpy}`
  const meta = [bytes(a.size), madeWith, `Added ${ago(a.mtime)}`, title !== a.name && a.name].filter(Boolean).join(' · ')
  const actions = job ? (
    <Link to="/activity" className="inline-flex h-9 items-center rounded-xl px-3 text-sm text-zinc-400 hover:bg-white/10 hover:text-white">
      Show log
    </Link>
  ) : (
    <>
      <Sheet trigger={(open) => <Button size="sm" variant="ghost" icon={<MoreHorizontal className="size-4" />} onClick={open} aria-label={`Actions for ${a.name}`} />}>
        {(close) => <MenuItem icon={<Trash2 />} danger onClick={() => { close(); setConfirmDelete(true) }}>Delete download… ({bytes(a.size)})</MenuItem>}
      </Sheet>
      {!blocked && (
        <Button size="sm" variant={reinstall ? 'secondary' : 'primary'} onClick={onInstall}>
          {reinstall ? 'Reinstall' : updates ? `Update ${updates}` : 'Install'}
        </Button>
      )}
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
          <span className="min-w-0 break-words font-medium text-zinc-100">{a.name}</span>
          {version && <Badge className="shrink-0">{version}</Badge>}
        </div>
        <div className="mt-0.5 line-clamp-2 break-words text-xs text-zinc-500">{meta}</div>
        {(broken || updates || unknown || (foreign && !blocked)) && !job && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {foreign && !blocked && <BetaBadge engine={foreign.family} />}
            {broken && <Badge tone="red">{BROKEN}</Badge>}
            {updates && <Badge tone="accent">New version of a game you have</Badge>}
            {unknown && <Badge tone="amber">No game found</Badge>}
          </div>
        )}
        {blocked && (a.blocked ?? engine?.reason) && <p className="mt-1.5 text-xs text-amber-200/80">{a.blocked ?? engine?.reason}</p>}
        {!blocked && !job && engine?.warnings.map((w) => (
          <p key={w} className="mt-1.5 text-xs text-amber-200/80">
            {w}
          </p>
        ))}
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
    <div className="mt-2.5">
      <div className="mb-1.5 flex justify-between gap-3 text-xs text-zinc-400">
        <span className="truncate">{job.stage || 'Installing'}</span>
        <span className="shrink-0 tabular-nums">{pct(job.progress)}</span>
      </div>
      <Progress value={job.progress} />
      <p className="mt-1 text-xs text-zinc-500">You can leave this page.</p>
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
          {deletes ? ' If uploaded through Renplay, the download is deleted after a successful install. Files copied in are kept.' : ''}
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

function UploadZone() {
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
          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:flex-row">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-300">
              <CloudUpload className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-zinc-100">
                Upload a game’s PC download<span className="hidden sm:inline">, or drop it here</span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                A .zip, .7z or .rar of any size. If the connection drops, pick the same file again and it continues.
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
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [limit, setLimit] = useState(30)
  const [filter, setFilter] = useState('all')
  if (isLoading) return <Spinner />
  const all = data?.games ?? []
  const vocabulary = data?.vocabulary ?? {}
  const games = all.filter((g) => matchesSearch(g, search, vocabulary) && (filter === 'all' || (filter === 'free' ? g.free === true || (g.free === undefined && g.nsfw === false) : g.state === 'completed')) && (!tag || gameTags(g, vocabulary).some((t) => t.id === tag)))
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
      {data?.status.errors.length ? <p className="mb-4 text-xs text-amber-300">Could not reach the catalog. Last updated {ago(data.status.fetchedAt)}.</p> : null}
      <input aria-label="Search catalog" placeholder="Search catalog" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(30) }} className="mb-4 h-11 w-full rounded-xl bg-white/5 px-4 text-sm text-white" />
      <div className="mb-4"><SegmentedControl value={filter} onChange={(value) => { setFilter(value); setLimit(30) }} options={[{ value: 'all', label: 'All' }, { value: 'free', label: 'Free' }, { value: 'completed', label: 'Completed' }]} /></div>
      <TagFilters tags={tagChips(all, vocabulary)} selected={tag} onSelect={(id) => { setTag(id); setLimit(30) }} />
      <p className="mb-4 text-sm text-zinc-400">Showing {Math.min(limit, games.length)} of {games.length}</p>
      {!games.length ? (
        <p className="text-sm text-zinc-500">{all.length ? 'No games match. Try a different search or tag.' : 'No games in the catalog yet.'}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {games.slice(0, limit).map((r) => (
            <RecipeCard key={r.id} recipe={r} />
          ))}
        </div>
      )}
      {games.length > limit && <div className="mt-5 text-center"><Button onClick={() => setLimit(limit + 30)}>Show more</Button></div>}
    </div>
  )
}
