import { useQueryClient } from '@tanstack/react-query'
import { Archive as ArchiveIcon, BadgeCheck, CloudUpload, ExternalLink, FileArchive, Fingerprint, Library, HardDrive, Pause, Play, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cover } from '../components/GameCard'
import { Badge, Button, Confirm, Empty, Modal, Progress, Spinner, Switch, Tabs, cx, errorText, useToast } from '../components/ui'
import { del, post, type Archive, type ArchiveInfo, type Recipe } from '../lib/api'
import { ago, bytes, capitalize, pct } from '../lib/format'
import { recipeLinks } from '../lib/links'
import { useArchives, useCatalog, useGames, useSystem } from '../lib/queries'
import { uploadArchive, type UploadHandle } from '../lib/upload'

type Tab = 'server' | 'upload' | 'catalog'

export default function AddGames() {
  const [tab, setTab] = useState<Tab>('server')
  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Add games</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Renplay takes the normal PC download of a Ren’Py game, unpacks its archives, converts images to WebP, builds it for the browser and keeps the original archive so you can uninstall and reinstall any time.
        </p>
      </div>
      <div className="mb-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'server', label: <><ArchiveIcon className="size-4" /> Archives on server</> },
            { id: 'upload', label: <><CloudUpload className="size-4" /> Upload</> },
            { id: 'catalog', label: <><Library className="size-4" /> Catalog</> },
          ]}
        />
      </div>
      {tab === 'server' && <ServerArchives />}
      {tab === 'upload' && <UploadTab onDone={() => setTab('server')} />}
      {tab === 'catalog' && <CatalogTab />}
    </div>
  )
}

function ServerArchives() {
  const { data, isLoading, refetch, isFetching } = useArchives()
  const [installing, setInstalling] = useState<Archive | null>(null)
  if (isLoading) return <Spinner />
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-zinc-400">
          Drop archives (.zip, .7z, .rar) into <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[12px] text-zinc-200">{data?.dir}</code> on the server.
        </p>
        <Button size="sm" variant="ghost" icon={<RefreshCw className={cx('size-4', isFetching && 'animate-spin')} />} onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>
      {!data?.archives.length ? (
        <Empty icon={<FileArchive className="size-10" />} title="No archives yet">
          Copy a game’s PC download into the archives folder (for example over SMB), or use the Upload tab.
        </Empty>
      ) : (
        <div className="space-y-3">
          {data.archives.map((a) => (
            <ArchiveRow key={a.path} archive={a} onInstall={() => setInstalling(a)} />
          ))}
        </div>
      )}
      {installing && <InstallDialog archive={installing} onClose={() => setInstalling(null)} />}
    </div>
  )
}

function ArchiveRow({ archive: a, onInstall }: { archive: Archive; onInstall: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [inspecting, setInspecting] = useState(false)
  const [info, setInfo] = useState<ArchiveInfo | null>(a.info)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const inspect = async () => {
    setInspecting(true)
    try {
      const r = await post<{ info: ArchiveInfo }>('/api/archives/inspect', { path: a.path })
      setInfo(r.info)
      void qc.invalidateQueries({ queryKey: ['archives'] })
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setInspecting(false)
    }
  }
  useEffect(() => {
    if (!a.info && /\.zip$/i.test(a.name)) void inspect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.path])
  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/[0.07] sm:flex-row sm:items-center">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.05] text-zinc-400">
        <FileArchive className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-zinc-100">{info?.title ?? a.name}</span>
          {info?.version && <Badge>{info.version}</Badge>}
          {a.recipe && (
            <Badge tone={a.recipe.status === 'verified' ? 'green' : 'violet'}>
              <BadgeCheck className="size-3" /> {a.recipe.status === 'verified' ? 'Verified recipe' : `Recipe: ${a.recipe.status}`}
              {a.recipe.exact ? '' : ' (by name)'}
            </Badge>
          )}
          {a.installedAs && <Badge tone="accent">Installed</Badge>}
          {!a.installedAs && a.existingGame && <Badge tone="amber">Updates {a.existingGame}</Badge>}
        </div>
        <div className="mt-1 truncate text-xs text-zinc-500">
          {a.path} · {bytes(a.size)} · Added {ago(a.mtime)}
          {info?.renpyVersion ? ` · Ren’Py ${info.renpyVersion}` : ''}
          {info?.saveDir ? ` · Saves to ${info.saveDir}` : ''}
          {info && !info.layout ? ' · No Ren’Py game detected' : ''}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {!info && (
          <Button size="sm" variant="ghost" loading={inspecting} icon={<Search className="size-4" />} onClick={inspect}>
            Inspect
          </Button>
        )}
        {!a.sha256 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Fingerprint className="size-4" />}
            title="Compute the checksum to match catalog recipes exactly"
            onClick={async () => {
              await post('/api/archives/hash', { path: a.path })
              toast('Checking the archive in the background', 'info')
            }}
          />
        )}
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)} aria-label="Delete archive" />
        <Button size="sm" variant={a.installedAs ? 'secondary' : 'primary'} onClick={onInstall}>
          {a.installedAs ? 'Reinstall' : a.existingGame ? 'Update' : 'Install'}
        </Button>
      </div>
      <Confirm
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title="Delete archive?"
        confirmLabel="Delete archive"
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
        Deletes {a.name} ({bytes(a.size)}) from the server. Installed games keep working, but can’t be reinstalled without it.
      </Confirm>
    </div>
  )
}

function InstallDialog({ archive, onClose }: { archive: Archive; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data: games } = useGames()
  const target = archive.installedAs ?? archive.existingGame ?? undefined
  const targetGame = games?.find((g) => g.id === target)
  const [reapply, setReapply] = useState(true)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      onClose={onClose}
      title={target ? `Update ${targetGame?.title ?? target}` : 'Install game'}
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
                toast('Started. Follow it in Activity.', 'success')
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
            {target ? 'Update' : 'Install'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-zinc-400">
          From <span className="text-zinc-200">{archive.name}</span> ({bytes(archive.size)}). Big games take a while; it runs on the server, you can close this page.
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

function UploadTab({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const { data: sys } = useSystem()
  const toast = useToast()
  const [drag, setDrag] = useState(false)
  const [up, setUp] = useState<{ file: File; sent: number; handle: UploadHandle; paused: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const start = (file: File) => {
    const handle = uploadArchive(file, (sent) => setUp((u) => (u ? { ...u, sent } : u)))
    setUp({ file, sent: 0, handle, paused: false })
    handle.promise
      .then((path) => {
        toast(`${file.name} uploaded`, 'success')
        void qc.invalidateQueries({ queryKey: ['archives'] })
        setUp(null)
        void path
        onDone()
      })
      .catch((e) => {
        if (errorText(e) !== 'Upload cancelled') toast(errorText(e), 'error')
        setUp(null)
      })
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
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
        className={cx(
          'flex min-h-72 flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-colors',
          drag ? 'border-accent-400 bg-accent-500/[0.06]' : 'border-white/10 bg-white/[0.02]',
        )}
      >
        {up ? (
          <div className="w-full max-w-sm">
            <FileArchive className="mx-auto mb-4 size-10 text-zinc-400" />
            <div className="truncate font-medium text-zinc-100">{up.file.name}</div>
            <div className="mb-4 mt-1 text-xs text-zinc-400">
              {bytes(up.sent)} of {bytes(up.file.size)} · {pct(up.sent / up.file.size)}
            </div>
            <Progress value={up.sent / up.file.size} />
            <div className="mt-5 flex justify-center gap-2">
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
            <p className="mt-4 text-[11px] text-zinc-500">Interrupted uploads continue where they stopped when you pick the same file again.</p>
          </div>
        ) : (
          <>
            <CloudUpload className="mb-4 size-10 text-zinc-400" />
            <h3 className="font-semibold text-white">Drop a game archive here</h3>
            <p className="mt-1 text-sm text-zinc-400">The PC/Linux download: .zip, .7z or .rar, any size.</p>
            <input ref={inputRef} type="file" accept=".zip,.7z,.rar,.tar,.tgz" className="hidden" onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
            <Button className="mt-6" variant="primary" onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
          </>
        )}
      </div>
      <div className="rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]">
        <h3 className="flex items-center gap-2 font-semibold text-white">
          <HardDrive className="size-4" /> Already on your server?
        </h3>
        <p className="mt-2 text-sm text-zinc-400">
          Copy downloads into the archives folder instead of uploading them. They show up under Archives on server, ready to install.
        </p>
        {sys?.paths.archives && <code className="mt-4 block break-all rounded-xl bg-black/30 px-3 py-2 text-[13px] text-zinc-300">{sys.paths.archives}</code>}
        <p className="mt-4 text-sm text-zinc-400">
          Get games from their developers in your browser (itch.io, Patreon, Steam). Download links from file hosts only work in the browser that opened them, so Renplay cannot fetch them for you.
        </p>
      </div>
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
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-sm text-zinc-400">
          Recipes from the renplay catalog: tested games with the exact archive, build settings and fixes that make them work in the browser. Get the archive from the official source, drop it into the archives folder, and it is matched automatically.
        </p>
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
      </div>
      {data?.status.errors.length ? <p className="mb-4 text-xs text-amber-300">Catalog sources unreachable: {data.status.errors.join('; ')}</p> : null}
      {!games.length ? (
        <Empty title="The catalog is empty">No recipes are available from {data?.status.urls.join(', ')} yet.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
  const tone = latest?.status === 'verified' ? 'green' : latest?.status === 'broken' ? 'red' : latest?.status === 'playable' ? 'violet' : 'neutral'
  return (
    <div className="overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.07]">
      <Cover game={{ title: r.title, cover: typeof r.cover === 'string' ? r.cover : null, nsfw: r.nsfw }} rounded={false} className="aspect-[63/50]" />
      <div className="space-y-3 p-4">
        <div>
          <div className="font-display text-lg font-semibold text-white">{r.title}</div>
          {r.developer && <div className="text-xs text-zinc-400">{r.developer}</div>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {latest && <Badge tone={tone}>{capitalize(latest.status)}</Badge>}
          {latest && <Badge>{latest.version}</Badge>}
          {r.local && <Badge tone="accent">In your library</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {recipeLinks(r.links).map(([k, label, url]) => (
            <a key={k} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-white/[0.05] px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10">
              {label} <ExternalLink className="size-3" />
            </a>
          ))}
          {r.local && (
            <Link to={`/game/${r.local.id}`} className="inline-flex items-center rounded-lg bg-accent-500/15 px-2.5 py-1 text-xs text-accent-300">
              Open
            </Link>
          )}
        </div>
        {latest?.archives?.[0] && <p className="truncate text-[11px] text-zinc-500">Expects {latest.archives.map((a) => a.name).join(' or ')}</p>}
      </div>
    </div>
  )
}

