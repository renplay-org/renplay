import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  BookOpen,
  Download,
  ExternalLink,
  Info,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import FileBrowser from '../components/FileBrowser'
import ActionBar from '../components/ActionBar'
import SceneCard from '../components/SceneCard'
import UpdateCard from '../components/UpdateCard'
import SegmentedControl from '../components/SegmentedControl'
import { playedTime } from '../components/UpNext'
import { useAdultView } from '../lib/adult'
import FavoriteButton from '../components/FavoriteButton'
import GameTags from '../components/GameTags'
import { Cover, creditText, hashUrl } from '../components/GameCard'
import SaveGallery from '../components/SaveGallery'
import { BetaBadge, Button, Confirm, Empty, Modal, Progress, Spinner, Switch, errorText, useToast } from '../components/ui'
import { api, del, post, slotName, type Game } from '../lib/api'
import { ago, bytes, capitalize, pct } from '../lib/format'
import { recipeLinks } from '../lib/links'
import { useCatalog, useGame, useSaves } from '../lib/queries'

import { useAuth } from '../lib/auth'
import { stateLabel } from '../lib/tags'

type Tab = 'saves' | 'files' | 'details'

export default function GamePage() {
  const admin = useAuth().data?.user.role === 'admin'
  const { id: gameId = '' } = useParams()
  const { data: game, isLoading, error } = useGame(gameId)
  const { data: catalog } = useCatalog()
  const [tab, setTab] = useState<Tab>('saves')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const view = useAdultView()
  const [expanded, setExpanded] = useState(false)
  const { data: saves } = useSaves(gameId, !!game?.saveDir)
  const latest = saves?.slots.find((s) => s.kind !== 'internal' && s.valid)
  useEffect(() => {
    if (game && window.location.hash === '#update') document.getElementById('update')?.scrollIntoView({ block: 'center' })
  }, [game?.id])

  if (isLoading)
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    )
  if (error || !game) return <Empty title="Game not found">{error ? errorText(error) : null}</Empty>

  const installed = game.status === 'installed'
  const renpy = game.family === 'renpy'
  // The hero behind the page. Below Shown an adult game's hero is its hash: colour, no picture.
  const hero = game.art.hero ?? game.art.grid
  const hidden = game.nsfw && view !== 'shown'
  const backdrop = (!hidden && hero?.url1x) || hashUrl(hero?.thumbhash)
  const credits = hidden ? [] : (['grid', 'hero'] as const).map((kind) => ({ kind, credit: game.art[kind]?.credit, made: game.art[kind]?.made })).filter((c, i, all) => c.credit && all.findIndex((o) => JSON.stringify(o.credit) === JSON.stringify(c.credit)) === i)
  const primary = () => navigate(`/play/${gameId}${latest ? `?resume=${encodeURIComponent(slotName(latest.file))}` : ''}`)

  return (
    <div className="animate-fade-in pb-20 sm:pb-0">
      <section className="relative -mx-4 -mt-5 mb-6 overflow-hidden sm:-mx-8 sm:-mt-6 sm:mb-8">
        <div className="absolute inset-0">
          {backdrop && <img src={backdrop} alt="" className="size-full scale-110 object-cover opacity-50 blur-3xl" />}
          <div className="absolute inset-0 bg-gradient-to-b from-ink-950/30 via-ink-950/70 to-ink-950" />
        </div>
        <div className="relative mx-auto max-w-[1600px] px-4 pb-6 pt-4 sm:px-8 sm:pb-8 sm:pt-6">
          <Link to="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
            <ArrowLeft className="size-4" /> Library
          </Link>
          <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-4 sm:grid-cols-[340px_minmax(0,1fr)] sm:gap-8 lg:items-start">
          <div className="min-w-0">
            <Cover game={game} className="aspect-[63/50] w-full shrink-0 shadow-2xl ring-1 ring-white/10" />
            {credits.length > 0 && (
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                {credits.map((c, i) => <span key={c.kind} className="block">{credits.length > 1 ? `${c.kind === 'grid' ? 'Poster' : 'Background'} ` : 'Art '}{creditText(c.credit)}{c.made ? ', fitted by Renplay' : ''}</span>)}
              </p>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-3">
              <h1 className="min-w-0 flex-1 font-display text-2xl font-bold tracking-tight text-white sm:text-4xl">{game.title}</h1>
              <FavoriteButton game={game} />
            </div>
            {game.developer && <p className="mt-1 text-sm text-zinc-400">By {game.developer}</p>}
            <p className="mt-2 text-sm text-zinc-400">{game.state && `${stateLabel[game.state]} · `}{game.version}</p>
            <BetaBadge engine={game.family} />
            <div className="hidden sm:block"><GameTags game={game} vocabulary={catalog?.vocabulary ?? {}} />{game.summary && <><p className={`mt-3 text-sm leading-relaxed text-zinc-300 ${expanded ? '' : 'line-clamp-3'}`}>{game.summary}</p><button className="min-h-11 text-sm text-accent-300" onClick={() => setExpanded(!expanded)}>{expanded ? 'Less' : 'More'}</button></>}</div>
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
                {admin && <Link to="/activity" className="mt-2 inline-block text-xs text-zinc-400 hover:text-zinc-200">
                  Details in Activity →
                </Link>}
              </div>
            ) : (
              <div className="mt-6 hidden flex-wrap gap-3 sm:flex">
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
          <div className="col-span-2 space-y-3 sm:hidden">
            <GameTags game={game} vocabulary={catalog?.vocabulary ?? {}} />
            {game.summary && <div><p className={`text-sm leading-relaxed text-zinc-300 ${expanded ? '' : 'line-clamp-3'}`}>{game.summary}</p><button className="min-h-11 text-sm text-accent-300" onClick={() => setExpanded(!expanded)}>{expanded ? 'Less' : 'More'}</button></div>}
          </div>
          </div>
        </div>
      </section>

      <div className="mb-8 grid gap-4 sm:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl bg-white/[0.03] p-5 ring-1 ring-white/10">
          <h2 className="mb-4 font-semibold text-white">Your progress</h2>
          <div className="flex items-center gap-4"><SceneCard game={game} save={game.latestSave} className="w-28 shrink-0" /><div className="min-w-0 text-sm text-zinc-400"><p className="text-zinc-200">{game.latestSave ? `${game.latestSave.label} · ${ago(game.latestSave.ctime)}` : game.lastPlayedAt ? `Last played ${ago(game.lastPlayedAt)}` : 'Not played yet'}</p><p className="mt-1">{playedTime(game.playTime)} · {game.saves.count} saves{game.saves.count > 0 ? ' · Synced' : ''}</p></div></div>
          <div className="mt-4"><Switch checked={!!game.finishedAt} label="Finished" hint="Finished stories leave Up next. Your saves are kept." onChange={async (on) => { try { await api(`/api/games/${game.id}/finished`, { method: 'PUT', json: { on } }); void qc.invalidateQueries({ queryKey: ['game', game.id] }); void qc.invalidateQueries({ queryKey: ['games'] }) } catch (error) { toast(errorText(error), 'error') } }} /></div>
        </section>
        <UpdateCard game={game} />
      </div>

      <div className="mb-6">
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            // Save slots and mods are Ren'Py's; other engines' games keep their saves themselves.
            ...(renpy
              ? [
                  { value: 'saves' as const, label: <><Save className="size-4" /> Saves</> },
                  ...(admin ? [{ value: 'files' as const, label: 'Mods' }] : []),
                ]
              : []),
            { value: 'details' as const, label: <><Info className="size-4" /> Details</> },
          ]}
        />
      </div>
      {renpy && tab === 'saves' && <>{!installed && <p className="mb-4 text-sm text-zinc-400">Install the game to load your saves.</p>}<SaveGallery game={game} /></>}
      {admin && renpy && tab === 'files' && <FileBrowser game={game} />}
      {(tab === 'details' || !renpy) && <Details game={game} />}
      {!game.job && <ActionBar>{installed ? <><Button variant="primary" onClick={primary}>{latest ? 'Resume' : 'Play'}</Button>{latest && <Button onClick={() => navigate(`/play/${gameId}`)}>Main menu</Button>}</> : <InstallButton game={game} />}</ActionBar>}
    </div>
  )
}

function InstallButton({ game }: { game: Game }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const admin = useAuth().data?.user.role === 'admin'
  if (!admin) return <span className="text-sm text-zinc-400">Ask an admin to install this game.</span>
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
  const admin = useAuth().data?.user.role === 'admin'
  const { data: catalog } = useCatalog()
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const pdfRef = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState<null | 'uninstall' | 'forget' | 'download'>(null)
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
    : game.recipe.status === 'broken'
      ? 'This version does not work in Renplay.'
      : !game.recipe.status ? 'This version is not in the catalog yet.' : ''

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
      <div className="space-y-5 lg:space-y-6">
        <Card title="About">
          {game.summary && <p className="mb-3 text-sm leading-relaxed text-zinc-300">{game.summary}</p>}
          <div className="divide-y divide-white/[0.06]">
            {game.developer && <Row label="Developer">{game.developer}</Row>}
            {game.state && <Row label="State">{stateLabel[game.state]}</Row>}
            {game.detectedVersion && game.detectedVersion !== game.version && <Row label="Detected version"><span className="text-zinc-500">{game.detectedVersion}</span></Row>}
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
          <GameTags game={game} vocabulary={catalog?.vocabulary ?? {}} showContent />
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

        {admin && <Card title="Your walkthrough">
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
        </Card>}
      </div>

      <Card title="Installation">
        <div className="divide-y divide-white/[0.06]">
          <Row label="Status">{STATUS[game.status]}</Row>
          {game.status === 'installed' && (
            <Row label="Size">{bytes(game.sizeBytes)}</Row>
          )}
          {game.screen && <Row label="Resolution">{`${game.screen[0]} × ${game.screen[1]}`}</Row>}
          {game.engineLabel ? <Row label="Made with">{game.engineLabel}</Row> : game.renpyVersion && <Row label="Made with">{`Ren’Py ${game.renpyVersion}`}</Row>}
          {game.engine && <Row label="Plays on">{`Ren’Py ${game.engine} web`}</Row>}
          {game.family === 'renpy' && game.saveDir && (
            <Row label="Save folder">
              <span className="font-mono text-[13px]">{game.saveDir}</span>
            </Row>
          )}
          {game.source.archive && <Row label="Source">{game.source.archive}</Row>}
          <Row label="Download">{game.canReinstall ? 'Kept for reinstalling' : 'Not kept. Add the download again to reinstall.'}</Row>
          {game.installedAt && <Row label="Installed">{capitalize(ago(game.installedAt))}</Row>}
        </div>
      </Card>
      {admin && <Card title="Danger zone">
        <p className="mb-4 text-sm text-zinc-400">Reinstall and uninstall keep your saves, mods and walkthrough. Removing a game from the library keeps its saves.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {game.canReinstall && (
            <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => setReinstall(true)}>
              {game.status === 'installed' ? 'Reinstall' : 'Install'}
            </Button>
          )}
          {game.canReinstall && <Button size="sm" variant="ghost" onClick={() => setConfirm('download')}>Delete download</Button>}
          {game.status === 'installed' && (
            <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('uninstall')}>
              Uninstall
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setConfirm('forget')}>
            Remove from library
          </Button>
        </div>
      </Card>}

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

      <Confirm open={confirm === 'download'} onClose={() => setConfirm(null)} danger title="Delete this download?" confirmLabel="Delete download" onConfirm={async () => {
        setConfirm(null)
        await act(() => del(`/api/games/${game.id}/download`), 'Download deleted')
      }}>
        Deletes {game.source.archive}. Reinstalling this game, or another game using the same download, will need the download again. Installed games and saves are kept.
      </Confirm>
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
