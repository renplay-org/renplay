import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, Download, ExternalLink, Info, MoreHorizontal, Play, RefreshCw, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import FileBrowser from '../components/FileBrowser'
import ActionBar from '../components/ActionBar'
import SceneCard from '../components/SceneCard'
import UpdateCard from '../components/UpdateCard'
import OfflineCard from '../components/OfflineCard'
import { Seg, Pill, Stars, TagPill } from '../lantern/controls'
import Stage, { travelToDoor } from '../lantern/Stage'
import { useRoom } from '../lantern/Room'
import { creditText, useHidden } from '../lantern/art'
import { playedTime } from '../lib/format'
import { useAdultView } from '../lib/adult'
import FavoriteButton from '../components/FavoriteButton'
import GameTags from '../components/GameTags'
import SaveGallery from '../components/SaveGallery'
import { BetaBadge, Button, Confirm, Empty, Menu, MenuItem, Modal, Progress, Spinner, Switch, errorText, useToast } from '../components/ui'
import { api, del, post, slotName, type ArtKind, type Game } from '../lib/api'
import ArtPicker from '../components/ArtPicker'
import { ago, bytes, capitalize, duration, pct, timeZone } from '../lib/format'
import { recipeLinks } from '../lib/links'
import { useCatalog, useGame, useSaves } from '../lib/queries'

import { useAuth } from '../lib/auth'
import { phoneLabel, stateLabel } from '../lib/tags'

type Tab = 'play' | 'saves' | 'walkthroughs' | 'files' | 'details' | 'manage'

export default function GamePage() {
  const admin = useAuth().data?.user.role === 'admin'
  const { id: gameId = '' } = useParams()
  const { data: game, isLoading, error } = useGame(gameId)
  const { data: catalog } = useCatalog()
  const [tab, setTab] = useState<Tab>('play')
  const [picker, setPicker] = useState<ArtKind | null>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const view = useAdultView()
  const actsRef = useRef<HTMLDivElement>(null)
  const { data: saves } = useSaves(gameId, !!game?.saveDir)
  const latest = saves?.slots.find((s) => s.kind !== 'internal' && s.valid)
  useEffect(() => {
    if (game && window.location.hash === '#update') document.getElementById('update')?.scrollIntoView({ block: 'center' })
  }, [game?.id])
  useRoom({ game: game ?? null, quiet: !game })

  if (isLoading)
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    )
  if (error || !game) return <Empty title="Game not found">{error ? errorText(error) : null}</Empty>

  const installed = game.status === 'installed'
  const renpy = game.family === 'renpy'
  const hidden = game.nsfw && view !== 'shown'
  const credits = hidden ? [] : (['grid', 'hero'] as const).map((kind) => ({ kind, credit: game.art[kind]?.credit, made: game.art[kind]?.made })).filter((c, i, all) => c.credit && all.findIndex((o) => JSON.stringify(o.credit) === JSON.stringify(c.credit)) === i)
  const primary = () => navigate(`/play/${gameId}${latest ? `?resume=${encodeURIComponent(slotName(latest.file))}` : ''}`)
  const resume = (menu: boolean) => {
    travelToDoor(game, hidden)
    navigate(`/play/${gameId}${!menu && latest ? `?resume=${encodeURIComponent(slotName(latest.file))}` : ''}`)
  }

  const meta = (
    <>
      {game.developer && <span>By {game.developer}</span>}
      {game.state && (
        <>
          <span className="sep">·</span>
          <span>{stateLabel[game.state]}</span>
        </>
      )}
      {game.version && (
        <>
          <span className="sep">·</span>
          <span>{game.version}</span>
        </>
      )}
      {game.free && (
        <>
          <span className="sep">·</span>
          <span>Free</span>
        </>
      )}
      {game.phone && (
        <>
          <span className="sep">·</span>
          <span>{phoneLabel[game.phone]}</span>
        </>
      )}
      {game.family !== 'renpy' && (
        <>
          <span className="sep">·</span>
          <BetaBadge engine={game.family} />
        </>
      )}
    </>
  )

  const body = (
    <>
      <GameTags game={game} vocabulary={catalog?.vocabulary ?? {}} />
      {game.summary && <p className="sum">{game.summary}</p>}
      {game.recipe?.continuesFrom.length ? <p className="small muted" style={{ marginTop: 10 }}>Continues from {game.recipe.continuesFrom.join(', ')}. The game finds those saves itself.</p> : null}
      {(credits.length > 0 || !hidden) && (
        <p className="xs muted" style={{ marginTop: 10, lineHeight: 1.6 }}>
          {credits.map((c) => (
            <span key={c.kind} style={{ display: 'block' }}>
              {credits.length > 1 ? `${c.kind === 'grid' ? 'Poster' : 'Background'} ` : 'Art '}
              {creditText(c.credit)}
              {c.made ? ', fitted by Renplay' : ''}
            </span>
          ))}
          {!hidden && (
            <button className="link" onClick={() => setPicker('grid')}>
              Change art
            </button>
          )}
        </p>
      )}
    </>
  )

  const actions = game.job ? (
    <div className="panel" style={{ maxWidth: 440, width: '100%' }}>
      <div className="row between small" style={{ marginBottom: 8 }}>
        <span className="muted-2">{game.job.status === 'queued' ? 'Queued' : game.job.stage || 'Working'}</span>
        <span className="tnum muted">{game.job.status === 'running' ? pct(game.job.progress) : ''}</span>
      </div>
      <Progress value={game.job.progress} indeterminate={game.job.status === 'queued'} />
      {admin && (
        <Link to="/activity" className="link-q xs" style={{ marginTop: 8, display: 'inline-block' }}>
          Details in Activity
        </Link>
      )}
    </div>
  ) : (
    <>
      {installed ? (
        <>
          <Pill variant="p" size="lg" icon={latest ? <Play /> : <Play />} onClick={() => resume(false)}>
            {latest ? 'Resume' : 'Play'}
          </Pill>
          {latest && (
            <Pill variant="s" size="lg" onClick={() => resume(true)}>
              Main menu
            </Pill>
          )}
        </>
      ) : (
        <InstallButton game={game} />
      )}
      {game.walkthroughs.length === 1 && (
        <Pill variant="q" size="lg" icon={<BookOpen />} href={game.walkthroughs[0]!.url} target="_blank" rel="noreferrer">
          Walkthrough
        </Pill>
      )}
      {game.walkthroughs.length > 1 && (
        <Pill variant="q" size="lg" icon={<BookOpen />} onClick={() => setTab('walkthroughs')}>
          Walkthroughs
        </Pill>
      )}
      {game.recipe?.links.walkthrough && (
        <Pill variant="q" size="lg" icon={<ExternalLink />} href={game.recipe.links.walkthrough} target="_blank" rel="noreferrer">
          Guide
        </Pill>
      )}
      <FavoriteButton game={game} />
    </>
  )

  return (
    <div style={{ paddingBottom: 20 }}>
      <Stage game={game} eyebrow={installed ? 'In your library' : game.status === 'installing' ? 'Installing' : 'Not installed'} back={{ to: '/', label: 'Library' }} meta={meta} body={body} actions={actions} actsRef={actsRef} />

      <div style={{ marginTop: 32, marginBottom: 24 }}>
        <Seg<Tab>
          scroll
          label="Game page sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'play' as const, label: <><Play /> Play</> },
            // Save slots and mods are Ren'Py's; other engines' games keep their saves themselves.
            ...(renpy ? [{ value: 'saves' as const, label: <><Save /> Saves</> }] : []),
            { value: 'walkthroughs' as const, label: <><BookOpen /> Walkthroughs</> },
            ...(admin && renpy ? [{ value: 'files' as const, label: 'Mods and options' }] : []),
            { value: 'details' as const, label: <><Info /> Details</> },
            ...(admin ? [{ value: 'manage' as const, label: 'Manage' }] : []),
          ]}
        />
      </div>
      {tab === 'play' && <PlayPane game={game} onSaves={renpy ? () => setTab('saves') : undefined} />}
      {renpy && tab === 'saves' && (
        <>
          {!installed && <p className="small muted" style={{ marginBottom: 16 }}>Install the game to load your saves.</p>}
          <SaveGallery game={game} />
        </>
      )}
      {admin && renpy && tab === 'files' && <FileBrowser game={game} />}
      {tab === 'walkthroughs' && <Details game={game} section="walkthroughs" />}
      {tab === 'details' && <Details game={game} section="details" onChangeArt={hidden ? undefined : setPicker} />}
      {!hidden && <ArtPicker game={game} open={!!picker} initialKind={picker ?? 'grid'} onClose={() => setPicker(null)} />}
      {admin && tab === 'manage' && <Details game={game} section="manage" />}
      {!game.job && (
        <ActionBar watch={actsRef}>
          {installed ? (
            <>
              <Pill variant="p" onClick={primary}>{latest ? 'Resume' : 'Play'}</Pill>
              {latest && <Pill variant="s" onClick={() => navigate(`/play/${gameId}`)}>Main menu</Pill>}
            </>
          ) : (
            <InstallButton game={game} />
          )}
        </ActionBar>
      )}
    </div>
  )
}

function InstallButton({ game }: { game: Game }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const admin = useAuth().data?.user.role === 'admin'
  if (!admin) return <span className="small muted">Ask an admin to install this game.</span>
  if (!game.canReinstall)
    return (
      <Pill variant="p" size="lg" icon={<Download />} to="/add">
        Add an archive to install
      </Pill>
    )
  return (
    <Pill
      variant="p"
      size="lg"
      disabled={busy}
      icon={<Download />}
      onClick={async () => {
        setBusy(true)
        try {
          await post(`/api/games/${game.id}/reinstall`, { reapplyMods: true })
          toast('Installing', 'info')
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
    </Pill>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row between" style={{ alignItems: 'flex-start', gap: 24 }}>
      <span className="muted small" style={{ flex: 'none' }}>{label}</span>
      <span className="small" style={{ minWidth: 0, overflowWrap: 'anywhere', textAlign: 'right' }}>{children}</span>
    </div>
  )
}

const STATUS: Record<Game['status'], string> = { installed: 'Installed', not_installed: 'Not installed', installing: 'Installing' }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h3 className="h3" style={{ marginBottom: 8 }}>{title}</h3>
      {children}
    </section>
  )
}

const ART_ROWS: Array<[ArtKind, string]> = [['grid', 'Grid'], ['wide', 'Wide'], ['hero', 'Hero'], ['logo', 'Logo'], ['icon', 'Icon']]

const STATUS_OPTIONS = [
  { value: 'playing', label: 'Playing' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'finished', label: 'Finished' },
] as const

interface GameHistory {
  totals: { seconds: number; sessions: number }
  days: Array<{ day: string; sessions: Array<{ startedAt: number; seconds: number }> }>
}

/** Play: your progress, your status and rating, updates, and the last sessions of this game. */
function PlayPane({ game, onSaves }: { game: Game; onSaves?: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const history = useQuery({ queryKey: ['history', game.id], queryFn: () => api<GameHistory>(`/api/history?game=${encodeURIComponent(game.id)}&days=30&tz=${encodeURIComponent(timeZone())}`) })
  const sessions = (history.data?.days ?? []).flatMap((d) => d.sessions).slice(0, 4)
  const save = async (path: string, json: unknown) => {
    try {
      await api(`/api/games/${game.id}/${path}`, { method: 'PUT', json })
      void qc.invalidateQueries({ queryKey: ['game', game.id] })
      void qc.invalidateQueries({ queryKey: ['games'] })
    } catch (error) {
      toast(errorText(error), 'error')
    }
  }
  return (
    <div className="grid2">
      <div className="stack">
        <section className="panel">
          <div className="row between" style={{ marginBottom: 14 }}>
            <h2 className="h3">Your progress</h2>
            {onSaves && (
              <button className="link small" onClick={onSaves} style={{ alignSelf: 'start' }}>
                All saves
              </button>
            )}
          </div>
          <div className="row" style={{ alignItems: 'center', gap: 16 }}>
            <SceneCard game={game} save={game.latestSave} style={{ width: 112, flex: 'none' }} />
            <div className="grow small muted">
              <p className="muted-2" style={{ fontSize: 15, fontWeight: 650 }}>
                {game.latestSave ? `${game.latestSave.label} · ${ago(game.latestSave.ctime)}` : game.lastPlayedAt ? `Last played ${ago(game.lastPlayedAt)}` : 'Not played yet'}
              </p>
              <p style={{ marginTop: 4 }}>
                {playedTime(game.playTime)} · {game.saves.count} {game.saves.count === 1 ? 'save' : 'saves'}
                {game.saves.count > 0 && navigator.onLine ? ' · Synced' : ''}
              </p>
            </div>
          </div>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 16 }} className="stack">
            <div>
              <h3 className="small muted-2" style={{ fontWeight: 650, marginBottom: 8 }}>Status</h3>
              <Seg
                small
                scroll
                label="Status"
                value={(game.playStatus ?? '') as string}
                onChange={(value) => void save('status', { status: value === game.playStatus ? '' : value })}
                options={STATUS_OPTIONS.map((o) => ({ value: o.value as string, label: o.label }))}
              />
              <p className="xs muted" style={{ marginTop: 8 }}>Stalled, Dropped and Finished leave Up next. Your saves are kept.</p>
            </div>
            <div>
              <h3 className="small muted-2" style={{ fontWeight: 650, marginBottom: 4 }}>Your rating</h3>
              <Stars value={game.rating ?? 0} onChange={(rating) => void save('rating', { rating })} />
            </div>
          </div>
        </section>
      </div>
      <div className="stack">
        <UpdateCard game={game} />
        <OfflineCard game={game} />
        <section className="panel">
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 className="h3">History</h2>
            <Link to="/history" className="link small">All history</Link>
          </div>
          {sessions.length ? (
            <div className="list tight">
              {sessions.map((s) => (
                <div key={s.startedAt} className="row between small">
                  <span className="muted-2">{capitalize(ago(s.startedAt))}</span>
                  <span className="muted tnum">{s.seconds < 60 ? 'Under a minute' : duration(s.seconds)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">{history.isPending ? 'Loading' : 'Nothing played yet.'}</p>
          )}
        </section>
      </div>
    </div>
  )
}

/** The Details, Walkthroughs and Manage panes: one component, so the shared actions and dialogs stay in one place. */
function Details({ game, section, onChangeArt }: { game: Game; section: 'details' | 'walkthroughs' | 'manage'; onChangeArt?: (kind: ArtKind) => void }) {
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
  const [rename, setRename] = useState<{ file: string; title: string } | null>(null)
  const uploadWalkthrough = async (file: File | undefined) => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    await act(() => api(`/api/games/${game.id}/walkthroughs`, { method: 'POST', body: fd }), 'Walkthrough added')
  }
  const links = recipeLinks(game.recipe?.links)
  const recipeStatus = !game.recipe
    ? 'Not in the catalog yet. Title and art come from the catalog once it has a recipe for this game.'
    : game.recipe.status === 'broken'
      ? 'This version does not work in Renplay.'
      : !game.recipe.status
        ? 'This version is not in the catalog yet.'
        : ''

  return (
    <div className={section === 'details' ? 'grid2' : 'stack'}>
      {section === 'details' && <div className="stack">
        <Card title="About">
          {game.summary && <p className="small muted-2" style={{ marginBottom: 12, lineHeight: 1.6 }}>{game.summary}</p>}
          <div className="list tight">
            {game.developer && <Row label="Developer">{game.developer}</Row>}
            {game.state && <Row label="State">{stateLabel[game.state]}</Row>}
            {game.detectedVersion && game.detectedVersion !== game.version && <Row label="Detected version"><span className="muted">{game.detectedVersion}</span></Row>}
            {game.update && (
              <Row label="Update">
                <span className="pink">
                  Version {game.update.version} ({game.update.status})
                </span>
              </Row>
            )}
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            {recipeStatus}
            {game.update ? ' Download the new version from the developer and add it to update. Saves carry over.' : ''}
          </p>
          <GameTags game={game} vocabulary={catalog?.vocabulary ?? {}} showContent />
          {links.length > 0 && (
            <div className="actions" style={{ marginTop: 12 }}>
              {links.map(([k, label, url]) => (
                <Pill key={k} variant="s" size="sm" href={url} target="_blank" rel="noreferrer" icon={<ExternalLink />}>
                  {label}
                </Pill>
              ))}
            </div>
          )}
        </Card>
      </div>}

      {section === 'walkthroughs' && (
        <div className="stack">
          {game.walkthroughs.length ? (
            game.walkthroughs.map((w, i) => (
              <div key={w.file} className="panel walk-row">
                <div className="grow" style={{ minWidth: 0 }}>
                  <p className="truncate" style={{ fontWeight: 650 }}>{w.title}</p>
                  <p className="small muted">
                    {{ pdf: 'PDF', image: 'Picture', text: 'Text' }[w.kind]} · {bytes(w.size)} · Added {ago(w.addedAt)}
                  </p>
                </div>
                <div className="actions">
                  <Pill variant={i === 0 ? 'p' : 's'} size="sm" icon={<BookOpen />} href={w.url} target="_blank" rel="noreferrer">
                    Open
                  </Pill>
                  {admin && (
                    <Menu trigger={(open) => <button className="ib" aria-label={`More for ${w.title}`} onClick={open}><MoreHorizontal /></button>}>
                      {(close) => (
                        <>
                          <MenuItem onClick={() => { close(); setRename({ file: w.file, title: w.title }) }}>Rename</MenuItem>
                          {i > 0 && <MenuItem onClick={() => { close(); void act(() => api(`/api/games/${game.id}/walkthroughs/${encodeURIComponent(w.file)}`, { method: 'PUT', json: { position: i - 1 } }), 'Moved up') }}>Move up</MenuItem>}
                          <MenuItem danger onClick={() => { close(); void act(() => del(`/api/games/${game.id}/walkthroughs/${encodeURIComponent(w.file)}`), 'Walkthrough removed') }}>Remove</MenuItem>
                        </>
                      )}
                    </Menu>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="small muted">{admin ? 'No walkthrough yet. Add a PDF, a picture or a text file.' : 'No walkthrough yet.'}</p>
          )}
          {game.recipe?.links.walkthrough && (
            <div className="panel walk-row">
              <div className="grow">
                <p style={{ fontWeight: 650 }}>The guide the catalog links</p>
                <p className="small muted">On the web</p>
              </div>
              <Pill variant="s" size="sm" icon={<ExternalLink />} href={game.recipe.links.walkthrough} target="_blank" rel="noreferrer">
                Open
              </Pill>
            </div>
          )}
          {admin && (
            <div>
              <input ref={pdfRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,.txt,.md,text/plain,text/markdown" className="hidden" onChange={(e) => { void uploadWalkthrough(e.target.files?.[0]); e.target.value = '' }} />
              <Button size="sm" icon={<BookOpen />} onClick={() => pdfRef.current?.click()}>
                Add a walkthrough
              </Button>
              <p className="xs muted" style={{ marginTop: 8 }}>A PDF, a picture or a text file, kept with the game for everyone who plays it.</p>
            </div>
          )}
          <Modal
            open={!!rename}
            onClose={() => setRename(null)}
            title="Rename walkthrough"
            footer={
              <Button variant="primary" onClick={() => { const r = rename!; setRename(null); void act(() => api(`/api/games/${game.id}/walkthroughs/${encodeURIComponent(r.file)}`, { method: 'PUT', json: { title: r.title } }), 'Renamed') }}>
                Save
              </Button>
            }
          >
            <label className="block small muted-2">
              Title
              <input className="input" style={{ marginTop: 8, width: '100%' }} value={rename?.title ?? ''} maxLength={100} onChange={(e) => setRename((r) => (r ? { ...r, title: e.target.value } : r))} />
            </label>
          </Modal>
        </div>
      )}

      {section === 'details' && <div className="stack">
        <Card title="Art">
          {onChangeArt ? (
            <div className="list tight">
              {ART_ROWS.map(([kind, label]) => {
                const f = game.art[kind]
                return (
                  <div key={kind} className="row between" style={{ gap: 12, minHeight: 'var(--hit)' }}>
                    <span className="grow">
                      <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
                      <span className="xs muted">{f ? <>{creditText(f.credit)}{f.made ? ', fitted by Renplay' : ''}</> : kind === 'logo' ? 'The title in text' : 'Not available yet'}</span>
                    </span>
                    <Pill variant="s" size="sm" onClick={() => onChangeArt(kind)}>Change</Pill>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="small muted">Pictures of this game are blurred at your adult games level, so its art cannot be chosen here.</p>
          )}
        </Card>
        <Card title="Installation">
          <div className="list tight">
            <Row label="Status">{STATUS[game.status]}</Row>
            {game.status === 'installed' && <Row label="Size">{bytes(game.sizeBytes)}</Row>}
            {game.screen && <Row label="Resolution">{`${game.screen[0]} × ${game.screen[1]}`}</Row>}
            {game.engineLabel ? <Row label="Made with">{game.engineLabel}</Row> : game.renpyVersion && <Row label="Made with">{`Ren’Py ${game.renpyVersion}`}</Row>}
            {game.engine && <Row label="Plays on">{`Ren’Py ${game.engine} web`}</Row>}
            {game.phone && <Row label="Phones">{phoneLabel[game.phone]}</Row>}
            {game.family === 'renpy' && game.saveDir && (
              <Row label="Save folder">
                <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 }}>{game.saveDir}</span>
              </Row>
            )}
            {game.source.archive && <Row label="Source">{game.source.archive}</Row>}
            <Row label="Download">{game.canReinstall ? 'Kept for reinstalling' : 'Not kept. Add the download again to reinstall.'}</Row>
            {game.installedAt && <Row label="Installed">{capitalize(ago(game.installedAt))}</Row>}
          </div>
        </Card>
      </div>}
        {section === 'manage' && admin && (
          <Card title="Install and remove">
            <p className="small muted" style={{ marginBottom: 12 }}>Reinstall and uninstall keep your saves, mods and walkthrough. Removing a game from the library keeps its saves.</p>
            <div className="actions">
              {game.canReinstall && (
                <Button size="sm" icon={<RefreshCw />} onClick={() => setReinstall(true)}>
                  {game.status === 'installed' ? 'Reinstall' : 'Install'}
                </Button>
              )}
              {game.canReinstall && (
                <Button size="sm" variant="ghost" onClick={() => setConfirm('download')}>
                  Delete download
                </Button>
              )}
              {game.status === 'installed' && (
                <Button size="sm" variant="danger" onClick={() => setConfirm('uninstall')}>
                  Uninstall
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setConfirm('forget')}>
                Remove from library
              </Button>
            </div>
          </Card>
        )}

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
        <p className="small muted" style={{ marginBottom: 16 }}>Rebuilds the game from {game.source.archive}. Saves are not touched.</p>
        {game.mods.files > 0 && <Switch checked={reapply} onChange={setReapply} label="Re-apply my mods" hint="Off moves your mod files aside instead of applying them to the fresh install." />}
      </Modal>

      <Confirm
        open={confirm === 'download'}
        onClose={() => setConfirm(null)}
        danger
        title="Delete this download?"
        confirmLabel="Delete download"
        onConfirm={async () => {
          setConfirm(null)
          await act(() => del(`/api/games/${game.id}/download`), 'Download deleted')
        }}
      >
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
