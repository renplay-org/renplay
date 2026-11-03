import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowUpCircle,
  BookOpen,
  Download,
  ExternalLink,
  FolderCog,
  Info,
  Play,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import FileBrowser from '../components/FileBrowser'
import { Cover } from '../components/GameCard'
import SaveGallery from '../components/SaveGallery'
import { Badge, Button, Confirm, Empty, Modal, Progress, Spinner, Switch, Tabs, errorText, useToast } from '../components/ui'
import { del, post, slotName, type Game } from '../lib/api'
import { ago, bytes, capitalize, pct } from '../lib/format'
import { recipeLinks } from '../lib/links'
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
  const backdrop = game.cover

  return (
    <div className="animate-fade-in">
      <section className="relative -mx-4 -mt-5 mb-6 overflow-hidden sm:-mx-8 sm:-mt-6 sm:mb-8">
        <div className="absolute inset-0">
          {backdrop && <img src={backdrop} alt="" className="size-full scale-110 object-cover opacity-50 blur-3xl" />}
          <div className="absolute inset-0 bg-gradient-to-b from-ink-950/30 via-ink-950/70 to-ink-950" />
        </div>
        <div className="relative mx-auto max-w-[1600px] px-4 pb-6 pt-4 sm:px-8 sm:pb-8 sm:pt-6">
          <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
            <ArrowLeft className="size-4" /> Library
          </Link>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:gap-8">
          <Cover game={game} className="aspect-[63/50] w-full max-w-md shrink-0 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)] ring-1 ring-white/10 lg:w-[380px]" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">{game.title}</h1>
            {game.developer && <p className="mt-1 text-sm text-zinc-400">By {game.developer}</p>}
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
              {game.update && (
                <Badge tone="accent">
                  <ArrowUpCircle className="size-3" /> Update to {game.update.version}
                </Badge>
              )}
              {game.tags.map((t) => (
                <Badge key={t}>{capitalize(t)}</Badge>
              ))}
            </div>
            <p className="mt-3 text-sm text-zinc-400">
              {game.lastPlayedAt ? `Last played ${ago(game.lastPlayedAt)}` : 'Not played yet'}
            </p>
            {game.recipe?.continuesFrom.length ? (
              <p className="mt-1 text-sm text-zinc-400">Continues from {game.recipe.continuesFrom.join(', ')}. The game finds those saves itself.</p>
            ) : null}

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

const STATUS: Record<Game['status'], string> = { installed: 'Installed', not_installed: 'Not installed', installing: 'Installing' }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/[0.07] sm:p-6">
      <h3 className="mb-2 font-semibold text-white">{title}</h3>
      {children}
    </div>
  )
}

function Details({ game }: { game: Game }) {
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const pdfRef = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState<null | 'uninstall' | 'forget'>(null)
  const [reinstall, setReinstall] = useState(false)
  const [reapply, setReapply] = useState(true)
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
  const uploadPdf = async (file: File | undefined) => {
    if (!file) return
    const fd = new FormData()
    fd.append('walkthrough', file)
    await act(async () => {
      const r = await fetch(`/api/games/${game.id}/walkthrough`, { method: 'POST', body: fd })
      if (!r.ok) throw new Error((await r.json()).error)
    }, 'Walkthrough added')
  }
  const links = recipeLinks(game.recipe?.links)
  const recipeStatus = !game.recipe
    ? 'Not in the catalog yet. Title and cover come from the catalog once it has a recipe for this game.'
    : game.recipe.status
      ? `${capitalize(game.recipe.status)} for this version in the catalog.`
      : 'This version is not in the catalog yet.'

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
      <div className="space-y-5 lg:space-y-6">
        <Card title="About">
          <div className="divide-y divide-white/[0.06]">
            {game.developer && <Row label="Developer">{game.developer}</Row>}
            {game.tags.length > 0 && <Row label="Tags">{game.tags.map(capitalize).join(', ')}</Row>}
            {game.update && (
              <Row label="Update">
                <span className="text-accent-300">
                  Version {game.update.version} ({game.update.status})
                </span>
              </Row>
            )}
          </div>
          <p className="mt-3 text-sm text-zinc-400">
            {recipeStatus}
            {game.update ? ' Download the new version from the developer and add it to update; saves carry over.' : ''}
          </p>
          {links.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {links.map(([k, label, url]) => (
                <a key={k} href={url} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="secondary" icon={<ExternalLink className="size-4" />}>
                    {label}
                  </Button>
                </a>
              ))}
            </div>
          )}
        </Card>

        <Card title="Your walkthrough">
          <p className="mb-4 text-sm text-zinc-400">A PDF you keep with the game. It opens from the game page.</p>
          <input ref={pdfRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => void uploadPdf(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<BookOpen className="size-4" />} onClick={() => pdfRef.current?.click()}>
              {game.walkthrough ? 'Replace PDF' : 'Add a PDF'}
            </Button>
            {game.walkthrough && (
              <Button size="sm" variant="ghost" onClick={() => act(() => del(`/api/games/${game.id}/walkthrough`), 'Walkthrough removed')}>
                Remove
              </Button>
            )}
          </div>
        </Card>
      </div>

      <Card title="Installation">
        <div className="divide-y divide-white/[0.06]">
          <Row label="Status">{STATUS[game.status]}</Row>
          {game.status === 'installed' && (
            <Row label="Size">{bytes(game.sizeBytes)}</Row>
          )}
          {game.screen && <Row label="Resolution">{`${game.screen[0]} × ${game.screen[1]}`}</Row>}
          {game.renpyVersion && <Row label="Made with">{`Ren’Py ${game.renpyVersion}`}</Row>}
          {game.engine && <Row label="Plays on">{`Ren’Py ${game.engine} web`}</Row>}
          {game.saveDir && (
            <Row label="Save folder">
              <span className="font-mono text-[13px]">{game.saveDir}</span>
            </Row>
          )}
          {(game.source.archive || game.source.url) && <Row label="Source">{game.source.archive ?? game.source.url}</Row>}
          {game.installedAt && <Row label="Installed">{capitalize(ago(game.installedAt))}</Row>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {game.canReinstall && (
            <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => setReinstall(true)}>
              {game.status === 'installed' ? 'Reinstall' : 'Install'}
            </Button>
          )}
          {game.status === 'installed' && (
            <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('uninstall')}>
              Uninstall
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setConfirm('forget')}>
            Remove from library
          </Button>
        </div>
      </Card>

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
        Frees {bytes(game.sizeBytes)} on the server. Saves, mods and your walkthrough are kept{game.canReinstall ? ', and you can install it again from its archive' : ''}.
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
