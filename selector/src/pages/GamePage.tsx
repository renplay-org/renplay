import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  Download,
  FolderCog,
  ImagePlus,
  Info,
  Play,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  FileCode2,
  Copy,
  ExternalLink,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import FileBrowser from '../components/FileBrowser'
import { Cover } from '../components/GameCard'
import SaveGallery from '../components/SaveGallery'
import { Badge, Button, Confirm, Empty, Modal, Progress, Spinner, Switch, Tabs, errorText, useToast } from '../components/ui'
import { api, del, post, slotName, coverUrl, type Game } from '../lib/api'
import { ago, bytes, pct } from '../lib/format'
import { useGame, useSaves } from '../lib/queries'

type Tab = 'saves' | 'files' | 'details'

export default function GamePage() {
  const { id: gameId = '' } = useParams()
  const { data: game, isLoading, error } = useGame(gameId)
  const [tab, setTab] = useState<Tab>('saves')
  const navigate = useNavigate()
  const { data: saves } = useSaves(gameId, !!game?.saveDir)
  const latest = saves?.slots.find((s) => s.kind !== 'internal' && s.valid)

  if (isLoading)
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    )
  if (error || !game) return <Empty title="Game not found">{error ? errorText(error) : null}</Empty>

  const installed = game.status === 'installed'
  const backdrop = coverUrl(game)

  return (
    <div className="animate-fade-in">
      <section className="relative -mx-4 -mt-6 mb-8 overflow-hidden sm:-mx-8">
        <div className="absolute inset-0">
          {backdrop && <img src={backdrop} alt="" className="size-full scale-110 object-cover opacity-50 blur-3xl" />}
          <div className="absolute inset-0 bg-gradient-to-b from-ink-950/30 via-ink-950/70 to-ink-950" />
        </div>
        <div className="relative mx-auto flex max-w-[1600px] flex-col gap-8 px-4 pb-8 pt-8 sm:px-8 lg:flex-row lg:items-end">
          <Cover game={game} className="aspect-video w-full max-w-xl shrink-0 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)] ring-1 ring-white/10 lg:w-[480px]" />
          <div className="min-w-0 flex-1">
            <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
              <ArrowLeft className="size-4" /> Library
            </Link>
            <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">{game.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {game.version && <Badge>{game.version}</Badge>}
              {installed ? <Badge tone="green">Installed · {bytes(game.sizeBytes)}</Badge> : <Badge tone="amber">Not installed</Badge>}
              {game.saves.count > 0 && (
                <Badge tone="accent">
                  <Save className="size-3" /> {game.saves.count} saves
                </Badge>
              )}
              {game.mods.files > 0 && (
                <Badge tone="violet">
                  <Puzzle className="size-3" /> Modded
                </Badge>
              )}
              {game.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            <p className="mt-3 text-sm text-zinc-400">
              {game.lastPlayedAt ? `Last played ${ago(game.lastPlayedAt)}` : 'Not played yet'}
              {game.recipe?.continuesFrom.length ? ` · continues from ${game.recipe.continuesFrom.join(', ')}; the game finds those saves itself` : ''}
            </p>

            {game.job ? (
              <div className="mt-6 max-w-md rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-zinc-200">{game.job.status === 'queued' ? 'Queued' : game.job.stage || 'Working'}</span>
                  <span className="tabular-nums text-zinc-400">{game.job.status === 'running' ? pct(game.job.progress) : ''}</span>
                </div>
                <Progress value={game.job.progress} indeterminate={game.job.status === 'queued'} />
                <Link to="/activity" className="mt-2 inline-block text-xs text-zinc-400 hover:text-zinc-200">
                  Details in Activity →
                </Link>
              </div>
            ) : (
              <div className="mt-6 flex flex-wrap gap-3">
                {installed ? (
                  <>
                    {latest && (
                      <Button variant="primary" size="lg" icon={<RotateCcw className="size-5" />} onClick={() => navigate(`/play/${gameId}?resume=${encodeURIComponent(slotName(latest.file))}`)}>
                        Resume
                      </Button>
                    )}
                    <Button variant={latest ? 'secondary' : 'primary'} size="lg" icon={<Play className="size-5" />} onClick={() => navigate(`/play/${gameId}`)}>
                      {latest ? 'Main menu' : 'Play'}
                    </Button>
                  </>
                ) : (
                  <InstallButton game={game} />
                )}
                {game.walkthrough && (
                  <a href={`/api/walkthroughs/${encodeURIComponent(game.walkthrough)}`} target="_blank" rel="noreferrer">
                    <Button size="lg" variant="ghost" icon={<BookOpen className="size-5" />}>
                      Walkthrough
                    </Button>
                  </a>
                )}
                {game.recipe?.links.walkthrough && (
                  <a href={game.recipe.links.walkthrough} target="_blank" rel="noreferrer">
                    <Button size="lg" variant="ghost" icon={<ExternalLink className="size-5" />}>
                      Guide
                    </Button>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="mb-6">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'saves', label: <><Save className="size-4" /> Saves</> },
            { id: 'files', label: <><FolderCog className="size-4" /> Mods & files</> },
            { id: 'details', label: <><Info className="size-4" /> Details</> },
          ]}
        />
      </div>
      {tab === 'saves' && <SaveGallery game={game} />}
      {tab === 'files' && <FileBrowser game={game} />}
      {tab === 'details' && <Details game={game} />}
    </div>
  )
}

function InstallButton({ game }: { game: Game }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  if (!game.canReinstall)
    return (
      <Link to="/add">
        <Button variant="primary" size="lg" icon={<Download className="size-5" />}>
          Add an archive to install
        </Button>
      </Link>
    )
  return (
    <Button
      variant="primary"
      size="lg"
      loading={busy}
      icon={<Download className="size-5" />}
      onClick={async () => {
        setBusy(true)
        try {
          await post(`/api/games/${game.id}/reinstall`, { reapplyMods: true })
          toast('Installing…', 'info')
          void qc.invalidateQueries({ queryKey: ['game', game.id] })
          void qc.invalidateQueries({ queryKey: ['jobs'] })
        } catch (e) {
          toast(errorText(e), 'error')
        } finally {
          setBusy(false)
        }
      }}
    >
      Install
    </Button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 text-sm">
      <span className="shrink-0 text-zinc-400">{label}</span>
      <span className="min-w-0 break-words text-right text-zinc-100">{children}</span>
    </div>
  )
}

function Details({ game }: { game: Game }) {
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const coverRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(game.title)
  const [tags, setTags] = useState(game.tags.join(', '))
  const [saveDir, setSaveDir] = useState(game.saveDir ?? '')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<null | 'uninstall' | 'forget'>(null)
  const [reinstall, setReinstall] = useState(false)
  const [reapply, setReapply] = useState(true)
  const [recipeOpen, setRecipeOpen] = useState(false)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['game', game.id] })
    void qc.invalidateQueries({ queryKey: ['games'] })
  }
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast(ok, 'success')
      refresh()
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  const upload = async (field: string, url: string, file: File | undefined) => {
    if (!file) return
    const fd = new FormData()
    fd.append(field, file)
    await act(async () => {
      const r = await fetch(url, { method: 'POST', body: fd })
      if (!r.ok) throw new Error((await r.json()).error)
    }, 'Uploaded')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]">
        <h3 className="mb-4 font-semibold text-white">Library entry</h3>
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs text-zinc-400">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 w-full rounded-xl bg-white/[0.05] px-3 text-sm ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-accent-400/60" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-zinc-400">Tags (comma separated)</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="romance, sandbox" className="h-10 w-full rounded-xl bg-white/[0.05] px-3 text-sm ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-accent-400/60" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-zinc-400">Save folder (Ren’Py config.save_directory)</span>
            <input value={saveDir} onChange={(e) => setSaveDir(e.target.value)} placeholder="detected automatically" className="h-10 w-full rounded-xl bg-white/[0.05] px-3 font-mono text-[13px] ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-accent-400/60" />
            <span className="mt-1 block text-[11px] text-zinc-500">
              {game.saveDirLocked ? 'Set by hand.' : game.saveDir ? 'Detected from the game.' : 'Not detected yet; starting the game fills it in.'} Games that share a folder share their saves.
            </span>
          </label>
          <Button
            variant="primary"
            loading={saving}
            onClick={async () => {
              setSaving(true)
              await act(
                () =>
                  api(`/api/games/${game.id}`, {
                    method: 'PATCH',
                    json: { title, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), ...(saveDir !== (game.saveDir ?? '') ? { saveDir } : {}) },
                  }),
                'Saved',
              )
              setSaving(false)
            }}
          >
            Save changes
          </Button>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3">
          <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => void upload('cover', `/api/games/${game.id}/cover`, e.target.files?.[0])} />
          <Button icon={<ImagePlus className="size-4" />} onClick={() => coverRef.current?.click()}>
            Change cover
          </Button>
          <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => void upload('walkthrough', `/api/games/${game.id}/walkthrough`, e.target.files?.[0])} />
          <Button icon={<BookOpen className="size-4" />} onClick={() => pdfRef.current?.click()}>
            {game.walkthrough ? 'Replace walkthrough PDF' : 'Add your walkthrough PDF'}
          </Button>
          {game.walkthrough && (
            <Button variant="ghost" onClick={() => act(() => del(`/api/games/${game.id}/walkthrough`), 'Walkthrough removed')}>
              Remove walkthrough
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]">
          <h3 className="mb-2 font-semibold text-white">Installation</h3>
          <div className="divide-y divide-white/[0.06]">
            <Row label="Status">{game.status.replace('_', ' ')}</Row>
            <Row label="Size">{bytes(game.sizeBytes)} · {game.fileCount.toLocaleString()} files</Row>
            <Row label="Resolution">{game.screen ? `${game.screen[0]} × ${game.screen[1]}` : '—'}</Row>
            <Row label="Made with">{game.renpyVersion ? `Ren’Py ${game.renpyVersion}` : '—'}</Row>
            <Row label="Engine">{game.engine ? `Ren’Py ${game.engine} web` : '—'}</Row>
            <Row label="Recipe">
              {game.recipe ? (
                <span>
                  {game.recipe.id}
                  {game.recipe.status ? ` · ${game.recipe.status}` : ' · version not in the catalog'}
                </span>
              ) : (
                'none'
              )}
            </Row>
            <Row label="Source">{game.source.archive ?? game.source.url ?? '—'}</Row>
            <Row label="Installed">{game.installedAt ? ago(game.installedAt) : '—'}</Row>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {game.status === 'installed' && (
              <Button size="sm" icon={<FileCode2 className="size-4" />} onClick={() => setRecipeOpen(true)}>
                Export recipe
              </Button>
            )}
            {game.canReinstall && (
              <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => setReinstall(true)}>
                {game.status === 'installed' ? 'Reinstall' : 'Install'}
              </Button>
            )}
            {game.status === 'installed' && (
              <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('uninstall')}>
                Uninstall (keep saves)
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setConfirm('forget')}>
              Remove from library
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={reinstall}
        onClose={() => setReinstall(false)}
        title={`${game.status === 'installed' ? 'Reinstall' : 'Install'} ${game.title}`}
        footer={
          <Button
            variant="primary"
            onClick={async () => {
              setReinstall(false)
              await act(() => post(`/api/games/${game.id}/reinstall`, { reapplyMods: reapply }), 'Installing in the background')
            }}
          >
            Start
          </Button>
        }
      >
        <p className="mb-4 text-sm text-zinc-400">Rebuilds the game from {game.source.archive}. Saves are not touched.</p>
        {game.mods.files > 0 && (
          <Switch checked={reapply} onChange={setReapply} label="Re-apply my mods" hint="Off moves your mod files aside instead of applying them to the fresh install." />
        )}
      </Modal>

      {recipeOpen && <RecipeDialog game={game} onClose={() => setRecipeOpen(false)} />}

      <Confirm
        open={confirm === 'uninstall'}
        onClose={() => setConfirm(null)}
        danger
        title="Uninstall this game?"
        confirmLabel="Uninstall"
        onConfirm={async () => {
          setConfirm(null)
          await act(() => del(`/api/games/${game.id}`), 'Uninstalled. Saves are kept.')
        }}
      >
        Frees {bytes(game.sizeBytes)} on the server. Saves, mods, cover and walkthrough are kept{game.canReinstall ? ', and you can install it again from its archive' : ''}.
      </Confirm>
      <Confirm
        open={confirm === 'forget'}
        onClose={() => setConfirm(null)}
        danger
        title="Remove from library?"
        confirmLabel="Remove"
        onConfirm={async () => {
          setConfirm(null)
          await act(() => del(`/api/games/${game.id}?forget=1`), 'Removed from the library')
          navigate('/')
        }}
      >
        Deletes the installed files and the library entry. Save files stay on the server and reappear when the game is added again.
      </Confirm>
    </div>
  )
}

function RecipeDialog({ game, onClose }: { game: Game; onClose: () => void }) {
  const toast = useToast()
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['recipe', game.id],
    queryFn: () => api<{ yaml: string; sha256Pending: boolean; hashJob: string | null }>(`/api/games/${game.id}/recipe`),
    refetchInterval: (q) => (q.state.data?.sha256Pending ? 4000 : false),
  })
  const file = `${game.recipe?.id ?? game.id}.yaml`
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Recipe for the catalog"
      footer={
        <>
          <span className="mr-auto text-xs text-zinc-500">{data?.sha256Pending ? 'Computing the archive checksum…' : `Save as recipes/${file}`}</span>
          <Button
            variant="ghost"
            icon={<Download className="size-4" />}
            disabled={!data}
            onClick={() => {
              const a = document.createElement('a')
              a.href = URL.createObjectURL(new Blob([data!.yaml], { type: 'text/yaml' }))
              a.download = file
              a.click()
              setTimeout(() => URL.revokeObjectURL(a.href), 1000)
            }}
          >
            Download
          </Button>
          <Button
            variant="primary"
            icon={<Copy className="size-4" />}
            disabled={!data}
            onClick={async () => {
              await navigator.clipboard.writeText(data!.yaml)
              toast('Recipe copied', 'success')
            }}
          >
            Copy
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-zinc-400">
        Filled in from this installation. Add the developer, links and what you tested, set the status, then open a pull request on{' '}
        <a className="text-accent-300 hover:underline" href="https://github.com/renplay-web/catalog" target="_blank" rel="noreferrer">
          renplay-web/catalog
        </a>
        .
      </p>
      {isLoading ? (
        <Spinner />
      ) : (
        <pre className="max-h-[55vh] overflow-auto rounded-xl bg-black/40 p-4 font-mono text-[12px] leading-relaxed text-zinc-200">{data?.yaml}</pre>
      )}
      {data?.sha256Pending && (
        <button onClick={() => void refetch()} className="mt-2 text-xs text-zinc-500 hover:text-zinc-300">
          Refresh
        </button>
      )}
    </Modal>
  )
}
