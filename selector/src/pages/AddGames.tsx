import { useQueryClient } from '@tanstack/react-query'
import { CloudUpload, FileArchive, MoreHorizontal, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import ActionMenu from '../components/ActionMenu'
import DocsLink from '../components/DocsLink'
import { Frame, tintOf } from '../lantern/art'
import { Pill, Bar, TagPill } from '../lantern/controls'
import { useRoom } from '../lantern/Room'
import { BetaBadge, Confirm, Spinner, Switch, MenuItem, cx, errorText, useToast } from '../lantern/ui'
import { del, post } from '../lib/api'
import type { Archive, ArchiveInfo, InspectResponse, Job } from '@shared/api'
import { ago, pct } from '../lib/format'
import { bytes } from '@shared/format'
import { useArchives, useCatalog, useGames, useJobs, useSystem } from '../lib/queries'
import { uploadArchive, type UploadHandle } from '../lib/upload'
import Sheet from '../lantern/Sheet'

// A game in the catalog works; only a release marked broken is worth a word.
const BROKEN = 'Does not work'

export default function AddGames() {
  useRoom({ game: null, quiet: true })
  // The teaser waits for the downloads above it, so it is not pushed down when they arrive.
  const archives = useArchives()
  return (
    <div>
      <h1 className="h1">Add games</h1>
      <p className="lead" style={{ marginTop: 6 }}>
        Add the PC download of a Ren’Py game, or an HTML game. Renplay builds it for the browser on the server.
      </p>
      <Downloads />
      {!archives.isLoading && <CatalogTeaser />}
    </div>
  )
}

/** The install job of an archive, while it is queued, paused or running. */
function activeJob(jobs: Job[] | undefined, a: Archive): Job | undefined {
  return jobs?.find((j) => j.type === 'import' && j.params?.source?.path === a.path && (j.status === 'queued' || j.status === 'paused' || j.status === 'running'))
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
    <Pill size="sm" variant="q" icon={<RefreshCw className={cx(isFetching && 'animate-spin')} />} onClick={() => void refetch()}>
      Refresh
    </Pill>
  )
  return (
    <div className="stack" style={{ gap: 32, marginTop: 24 }}>
      <UploadZone />
      {jobs?.jobs.some((j) => j.type === 'import' && (j.status === 'failed' || j.status === 'interrupted')) && (
        <p className="small muted">
          An install did not finish. <Link className="link" to="/activity">Open Activity</Link> for its log, or read <DocsLink path="troubleshooting/">Troubleshooting</DocsLink>.
        </p>
      )}
      <section className="sec" style={{ marginTop: 0 }}>
        <div className="sec-h">
          <h2 className="h2">
            Downloads<span className="n">{archives.length}</span>
          </h2>
          <span className="row" style={{ gap: 12 }}>
            {data?.dir && <code className="xs hide-phone">{data.dir}</code>}
            {refresh}
          </span>
        </div>
        {!archives.length ? (
          <p className="small muted">Downloads you add show up here.</p>
        ) : (
          <>
            {ready.length > 0 && <RowGroup title="Ready to install">{ready.map((a) => <ArchiveRow key={a.path} archive={a} job={job(a)} onInstall={() => setInstalling(a)} />)}</RowGroup>}
            {installed.length > 0 && <RowGroup title="Installed">{installed.map((a) => <ArchiveRow key={a.path} archive={a} onInstall={() => setInstalling(a)} />)}</RowGroup>}
            {others.length > 0 && (
              <details>
                <summary className="small muted" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  Other engines ({others.length})
                </summary>
                <RowGroup title="Other engines">{others.map((a) => <ArchiveRow key={a.path} archive={a} onInstall={() => setInstalling(a)} />)}</RowGroup>
              </details>
            )}
          </>
        )}
        {sys && (
          <div className="notice" style={{ marginTop: 16 }}>
            <FileArchive />
            <div className="grow">
              {sys.keepDownloads ? (
                <>
                  <b>Downloads are kept</b> after a game installs, so you can reinstall without downloading again. Files you copied into the folder yourself are never deleted by Renplay.
                </>
              ) : (
                <>Uploads through Renplay are deleted after a successful install. Files copied in stay here. Add a deleted download again to reinstall.</>
              )}
            </div>
            <Link className="link small" to="/settings" style={{ flex: 'none', alignSelf: 'center' }}>
              Storage
            </Link>
          </div>
        )}
      </section>
      {installing && <InstallDialog archive={installing} deletes={sys ? !sys.keepDownloads : false} onClose={() => setInstalling(null)} />}
    </div>
  )
}

function RowGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <h3 className="small muted" style={{ fontWeight: 650, marginBottom: 4 }}>
        {title}
      </h3>
      <div className="rows">{children}</div>
    </div>
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
    post<InspectResponse>('/api/archives/inspect', { path: a.path })
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
  const blocked = !a.installedAs && engine?.installable === false
  const madeWith = foreign ? foreign.label : renpy && `Ren’Py ${renpy}`
  const meta = [bytes(a.size), madeWith, `Added ${ago(a.mtime)}`, title !== a.name && a.name].filter(Boolean).join(' · ')
  return (
    <div className="r stack-ph">
      {a.recipe?.art.grid ? (
        <div className="mini">
          <Frame game={{ title, art: a.recipe.art, nsfw: a.recipe.nsfw }} kind="sq" />
        </div>
      ) : (
        <div className="ic">
          <FileArchive />
        </div>
      )}
      <div className="grow">
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="t">{a.name}</span>
          {version && <TagPill>{version}</TagPill>}
          {a.installedAs && <TagPill tone="green">Installed</TagPill>}
          {updates && <TagPill tone="pink">Update for {updates}</TagPill>}
          {broken && <TagPill tone="red">{BROKEN}</TagPill>}
          {unknown && !job && <TagPill tone="amber">No game found</TagPill>}
          {foreign && !blocked && <BetaBadge engine={foreign.family} />}
        </div>
        <div className="m">{meta}</div>
        {blocked && engine?.reason && <p className="m amber">{engine.reason}</p>}
        {!blocked && !job && engine?.warnings.map((w) => (
          <p key={w} className="m amber">
            {w}
          </p>
        ))}
        {job && <JobLine job={job} />}
      </div>
      <div className="end">
        {job ? (
          <Pill variant="q" size="sm" to="/activity">
            Show log
          </Pill>
        ) : (
          <>
            {!blocked && (
              <Pill variant={reinstall ? 's' : 'p'} size="sm" onClick={onInstall}>
                {reinstall ? 'Reinstall' : updates ? 'Update' : 'Install'}
              </Pill>
            )}
            <ActionMenu trigger={(open) => <Pill size="sm" variant="q" icon={<MoreHorizontal />} onClick={open} aria-label={`Actions for ${a.name}`} />}>
              {(close) => (
                <MenuItem icon={<Trash2 />} danger onClick={() => { close(); setConfirmDelete(true) }}>
                  Delete download ({bytes(a.size)})
                </MenuItem>
              )}
            </ActionMenu>
          </>
        )}
      </div>
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
  if (job.status === 'queued') return <div className="m">Waiting for the install before it</div>
  if (job.status === 'paused') return <div className="m">Paused. Resume it in Activity.</div>
  return (
    <div style={{ marginTop: 10, maxWidth: 420 }}>
      <div className="row between xs muted" style={{ marginBottom: 6 }}>
        <span className="truncate">{job.stage || 'Installing'}</span>
        <span className="tnum" style={{ flex: 'none' }}>{pct(job.progress)}</span>
      </div>
      <Bar thin value={job.progress} />
      <p className="xs muted" style={{ marginTop: 4 }}>You can leave this page.</p>
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
    <Sheet
      open
      onClose={onClose}
      title={archive.installedAs ? `Reinstall ${targetGame?.title ?? title}` : target ? `Update ${targetGame?.title ?? target}` : `Install ${title}`}
      footer={
        <>
          <Pill variant="q" onClick={onClose}>
            Cancel
          </Pill>
          <Pill
            variant="p"
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
          </Pill>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <p className="small muted">
          From <span className="muted-2">{archive.name}</span> ({bytes(archive.size)}). It installs on the server; big games take a few minutes, and you can leave this page.
          {deletes ? ' If uploaded through Renplay, the download is deleted after a successful install. Files copied in are kept.' : ''}
        </p>
        {target && <div className="notice amber">Replaces the installed version. Saves stay where they are.</div>}
        {targetGame && targetGame.mods.files > 0 && <Switch checked={reapply} onChange={setReapply} label={`Re-apply my mods (${targetGame.mods.files} changes)`} hint="Mods made for the old version may not work with the new one. Off moves them aside." />}
      </div>
    </Sheet>
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
      className="panel"
      style={{ border: drag ? '1.5px dashed var(--pink)' : '1.5px dashed var(--plate-3-flat)', textAlign: 'center', padding: '28px 18px' }}
    >
      {up ? (
        <div className="stack" style={{ gap: 12, textAlign: 'left' }}>
          <div className="row between small">
            <span className="truncate" style={{ fontWeight: 650 }}>{up.file.name}</span>
            <span className="tnum muted" style={{ flex: 'none' }}>{pct(up.sent / up.file.size)}</span>
          </div>
          <Bar value={up.sent / up.file.size} />
          <div className="xs muted">
            {bytes(up.sent)} of {bytes(up.file.size)}. If it stops, pick the same file again to continue.
          </div>
          <div className="actions" style={{ justifyContent: 'center' }}>
            {up.paused ? (
              <Pill size="sm" icon={<Play />} onClick={() => (up.handle.resume(), setUp({ ...up, paused: false }))}>
                Resume
              </Pill>
            ) : (
              <Pill size="sm" icon={<Pause />} onClick={() => (up.handle.pause(), setUp({ ...up, paused: true }))}>
                Pause
              </Pill>
            )}
            <Pill size="sm" variant="q" icon={<X />} onClick={() => up.handle.cancel()}>
              Cancel
            </Pill>
          </div>
        </div>
      ) : (
        <>
          <div className="muted" style={{ display: 'flex', justifyContent: 'center' }}>
            <CloudUpload style={{ width: 28, height: 28 }} />
          </div>
          <div className="h3" style={{ marginTop: 8 }}>
            Drop a download here, or choose a file
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>
            Zip, 7z or rar of any size. If the connection drops, pick the same file again and it continues.
          </p>
          <input ref={inputRef} type="file" accept=".zip,.7z,.rar,.tar,.tgz" className="hidden" onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
          <div className="actions" style={{ justifyContent: 'center', marginTop: 14 }}>
            <Pill variant="p" icon={<CloudUpload />} onClick={() => inputRef.current?.click()}>
              Choose a file
            </Pill>
          </div>
        </>
      )}
    </div>
  )
}

function CatalogTeaser() {
  const { data } = useCatalog()
  const free = (data?.games ?? []).filter((r) => r.free === true && !r.local).slice(0, 6)
  if (!free.length) return null
  return (
    <section className="sec">
      <div className="sec-h">
        <h2 className="h2">Not sure what to add?</h2>
        <Link to="/catalog">Browse the catalog</Link>
      </div>
      <div className="shelf" data-row>
        {free.map((r) => (
          <Link key={r.id} to="/catalog" className="card" style={{ ['--tint' as string]: tintOf(r.art) }}>
            <Frame game={r} kind="grid" />
            <div className="ct">{r.title}</div>
            <div className="cm">
              <span className="truncate">{r.developer}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
