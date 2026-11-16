import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, ExternalLink, MoreHorizontal, Play, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import FileBrowser from '../components/FileBrowser'
import ActionBar from '../components/ActionBar'
import InstallButton from '../components/InstallButton'
import { PlayPane } from './PlayPane'
import { Pill, Bar, IconBtn } from '../lantern/controls'
import { Tabs, panelId, tabId } from '../lantern/Tabs'
import Stage, { travelToDoor } from '../lantern/Stage'
import { useRoom } from '../lantern/Room'
import { creditText } from '../lantern/art'
import { useAdultView } from '../lib/adult'
import FavoriteButton from '../components/FavoriteButton'
import GameTags from '../components/GameTags'
import SaveGallery from '../components/SaveGallery'
import { BetaBadge, Confirm, Empty, Menu, MenuItem, Spinner, Switch, errorText, useToast } from '../lantern/ui'
import { api, del, post } from '../lib/api'
import type { Game } from '@shared/api'
import type { ArtKind } from '@shared/recipe'
import ArtPicker from '../components/ArtPicker'
import { ago, capitalize, jobStage, pct } from '../lib/format'
import { bytes } from '@shared/format'
import { recipeLinks, playLink, popupClick } from '../lib/links'
import { demoPlayTarget, useDemoEmbed } from '../lib/demo-embed'
import { isRenpy } from '@shared/family'
import { useCatalog, useGame, useSaves } from '../lib/queries'

import { useAuth, useStaticDemo } from '../lib/auth'
import { phoneLabel, stateLabel } from '../lib/tags'
import Sheet from '../lantern/Sheet'

type Tab = 'play' | 'saves' | 'walkthroughs' | 'files' | 'details' | 'manage'

export default function GamePage() {
  const admin = useAuth().data?.user.role === 'admin'
  const staticDemo = useStaticDemo()
  const { id: gameId = '' } = useParams()
  const { data: game, isLoading, error } = useGame(gameId)
  const { data: catalog } = useCatalog()
  // Manage saves in the player's menu lands here.
  const [tab, setTab] = useState<Tab>(() => (window.location.hash === '#saves' ? 'saves' : 'play'))
  const [picker, setPicker] = useState<ArtKind | null>(null)
  const view = useAdultView()
  const embed = useDemoEmbed()
  const actsRef = useRef<HTMLDivElement>(null)
  const { data: saves } = useSaves(gameId, !!game?.saveDir)
  const latest = saves?.slots.find((s) => s.kind !== 'internal' && s.valid)
  useEffect(() => {
    if (game && window.location.hash === '#update') document.getElementById('update')?.scrollIntoView({ block: 'center' })
  }, [game?.id])
  useRoom({ game: game ?? null, quiet: !game })
  // The app's titles: Renplay, or the game's name with it.
  useEffect(() => {
    document.title = game ? `${game.title} · Renplay` : 'Renplay'
    return () => {
      document.title = 'Renplay'
    }
  }, [game?.title])

  if (isLoading)
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    )
  if (error || !game) return <Empty title="Game not found">{error ? errorText(error) : null}</Empty>

  const installed = game.status === 'installed'
  const renpy = isRenpy(game)
  const hidden = game.nsfw && view !== 'shown'
  // The picture a person chooses is kept by the server.
  const noPicker = hidden || staticDemo
  const credits = hidden ? [] : (['grid', 'hero'] as const).map((kind) => ({ kind, credit: game.art[kind]?.credit, made: game.art[kind]?.made })).filter((c, i, all) => c.credit && all.findIndex((o) => JSON.stringify(o.credit) === JSON.stringify(c.credit)) === i)

  // The parts the game has. The line draws the mark between them, so none is left at the end of a wrapped line.
  const meta = (
    <div className="sepline">
      {game.developer && <span>By {game.developer}</span>}
      {game.state && <span>{stateLabel[game.state]}</span>}
      {game.version && <span>{game.version}</span>}
      {game.free && <span>Free</span>}
      {game.phone && <span>{phoneLabel[game.phone]}</span>}
      {!isRenpy(game) && <span><BetaBadge engine={game.family} /></span>}
    </div>
  )

  const body = (
    <>
      <GameTags game={game} vocabulary={catalog?.vocabulary ?? {}} />
      {game.summary && <p className="sum">{game.summary}</p>}
      {game.recipe?.continuesFrom.length ? <p className="small muted" style={{ marginTop: 10 }}>Continues from {game.recipe.continuesFrom.join(', ')}. The game finds those saves itself.</p> : null}
      {(credits.length > 0 || !noPicker) && (
        <div className="sepline xs muted" style={{ marginTop: 10, lineHeight: 1.6 }}>
          {credits.map((c) => (
            <span key={c.kind}>
              {credits.length > 1 ? `${c.kind === 'grid' ? 'Poster' : 'Background'} ` : 'Art '}
              {creditText(c.credit)}
              {c.made ? ', fitted by Renplay' : ''}
            </span>
          ))}
          {!noPicker && (
            <span>
              <button className="link-q" onClick={() => setPicker('grid')}>
                Change art
              </button>
            </span>
          )}
        </div>
      )}
    </>
  )

  const actions = game.job ? (
    <div className="sect" style={{ maxWidth: 440, width: '100%' }}>
      <div className="row between small" style={{ marginBottom: 8 }}>
        <span className="muted-2">{jobStage(game.job, 'Working')}</span>
        <span className="tnum muted">{game.job.status === 'running' ? pct(game.job.progress) : ''}</span>
      </div>
      <Bar value={game.job.progress} indeterminate={game.job.status === 'queued'} />
      {admin && (
        <Link to="/activity" className="link-q xs" style={{ marginTop: 8, display: 'inline-block' }}>
          Details in Activity
        </Link>
      )}
    </div>
  ) : (
    <>
      {installed ? (
        <Pill variant="p" size="lg" icon={<Play />} to={playLink(gameId, latest?.file)} onClick={() => travelToDoor(game, hidden)}>
          {latest ? 'Resume' : 'Play'}
        </Pill>
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
        <Pill variant="q" size="lg" icon={<ExternalLink />} href={game.recipe.links.walkthrough} target="_blank" rel="noreferrer" onClick={popupClick(game.recipe.links.walkthrough)}>
          Guide
        </Pill>
      )}
      <FavoriteButton game={game} />
    </>
  )

  return (
    <div style={{ paddingBottom: 20 }}>
      <Stage game={game} under={installed && !game.job && renpy && latest ? <Link className="link-q" to={playLink(gameId)} target={demoPlayTarget(embed)} onClick={() => travelToDoor(game, hidden)}>Start from the main menu</Link> : undefined} eyebrow={installed ? 'In your library' : game.status === 'installing' ? 'Installing' : 'Not installed'} back={{ to: '/', label: 'Library' }} meta={meta} body={body} actions={actions} actsRef={actsRef} />

      <div style={{ marginTop: 32, marginBottom: 24 }}>
        <Tabs<Tab>
          label="Game page sections"
          group="game"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'play' as const, label: 'Play' },
            // Save slots and mods are Ren'Py's; other engines' games keep their saves themselves.
            ...(renpy ? [{ value: 'saves' as const, label: 'Saves' }] : []),
            { value: 'walkthroughs' as const, label: 'Walkthroughs' },
            ...(admin && renpy ? [{ value: 'files' as const, label: 'Mods and files' }] : []),
            { value: 'details' as const, label: 'Details' },
            ...(admin ? [{ value: 'manage' as const, label: 'Manage' }] : []),
          ]}
        />
      </div>
      <div role="tabpanel" id={panelId('game', tab)} aria-labelledby={tabId('game', tab)}>
        {tab === 'play' && <PlayPane game={game} onSaves={renpy ? () => setTab('saves') : undefined} />}
        {renpy && tab === 'saves' && (
          <>
            {!installed && <p className="small muted" style={{ marginBottom: 16 }}>Install the game to load your saves.</p>}
            <SaveGallery game={game} />
          </>
        )}
        {admin && renpy && tab === 'files' && <FileBrowser game={game} />}
        {tab === 'walkthroughs' && <Details game={game} section="walkthroughs" />}
        {tab === 'details' && <Details game={game} section="details" onChangeArt={noPicker ? undefined : setPicker} />}
        {admin && tab === 'manage' && <Details game={game} section="manage" />}
      </div>
      {!noPicker && <ArtPicker game={game} open={!!picker} initialKind={picker ?? 'grid'} onClose={() => setPicker(null)} />}
      {!game.job && (
        <ActionBar watch={actsRef}>
          {installed ? (
            <Pill variant="p" to={playLink(gameId, latest?.file)}>{latest ? 'Resume' : 'Play'}</Pill>
          ) : (
            <InstallButton game={game} />
          )}
        </ActionBar>
      )}
    </div>
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
            {game.version && (
              <Row label="Version">
                {game.version}
                {game.update && <span className="muted"> · {game.update.version} in the catalog</span>}
              </Row>
            )}
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            {recipeStatus}
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
          {game.walkthroughs.length || game.recipe?.links.walkthrough ? (
            <div className="rows">
            {game.walkthroughs.map((w, i) => (
              <div key={w.file} className="r walk-row">
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
                    <Menu trigger={(open) => <IconBtn label={`More for ${w.title}`} onClick={open}><MoreHorizontal /></IconBtn>}>
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
            ))}
            {game.recipe?.links.walkthrough && (
              <div className="r walk-row">
                <div className="grow">
                  <p style={{ fontWeight: 650 }}>The guide the catalog links</p>
                  <p className="small muted">On the web</p>
                </div>
                <Pill variant="s" size="sm" icon={<ExternalLink />} href={game.recipe.links.walkthrough} target="_blank" rel="noreferrer" onClick={popupClick(game.recipe.links.walkthrough)}>
                  Open
                </Pill>
              </div>
            )}
            </div>
          ) : (
            <p className="small muted">{admin ? 'No walkthrough yet. Add a PDF, a picture or a text file.' : 'No walkthrough yet.'}</p>
          )}
          {admin && (
            <div>
              <input ref={pdfRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp,.txt,.md,text/plain,text/markdown" className="hidden" onChange={(e) => { void uploadWalkthrough(e.target.files?.[0]); e.target.value = '' }} />
              <Pill size="sm" icon={<BookOpen />} onClick={() => pdfRef.current?.click()}>
                Add a walkthrough
              </Pill>
              <p className="xs muted" style={{ marginTop: 8 }}>A PDF, a picture or a text file, kept with the game for everyone who plays it.</p>
            </div>
          )}
          <Sheet
            open={!!rename}
            onClose={() => setRename(null)}
            title="Rename walkthrough"
            footer={
              <Pill variant="p" onClick={() => { const r = rename!; setRename(null); void act(() => api(`/api/games/${game.id}/walkthroughs/${encodeURIComponent(r.file)}`, { method: 'PUT', json: { title: r.title } }), 'Renamed') }}>
                Save
              </Pill>
            }
          >
            <label className="block small muted-2">
              Title
              <input className="input" style={{ marginTop: 8, width: '100%' }} value={rename?.title ?? ''} maxLength={100} onChange={(e) => setRename((r) => (r ? { ...r, title: e.target.value } : r))} />
            </label>
          </Sheet>
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
            {isRenpy(game) && game.saveDir && (
              <Row label="Save folder">
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{game.saveDir}</span>
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
                <Pill size="sm" icon={<RefreshCw />} onClick={() => setReinstall(true)}>
                  {game.status === 'installed' ? 'Reinstall' : 'Install'}
                </Pill>
              )}
              {game.canReinstall && (
                <Pill size="sm" variant="q" onClick={() => setConfirm('download')}>
                  Delete download
                </Pill>
              )}
              {game.status === 'installed' && (
                <Pill size="sm" variant="d" onClick={() => setConfirm('uninstall')}>
                  Uninstall
                </Pill>
              )}
              <Pill size="sm" variant="q" onClick={() => setConfirm('forget')}>
                Remove from library
              </Pill>
            </div>
          </Card>
        )}

      <Sheet
        open={reinstall}
        onClose={() => setReinstall(false)}
        title={`${game.status === 'installed' ? 'Reinstall' : 'Install'} ${game.title}`}
        footer={
          <Pill
            variant="p"
            onClick={async () => {
              setReinstall(false)
              await act(() => post(`/api/games/${game.id}/reinstall`, { reapplyMods: reapply }), 'Installing in the background')
            }}
          >
            Start
          </Pill>
        }
      >
        <p className="small muted" style={{ marginBottom: 16 }}>Rebuilds the game from {game.source.archive}. Saves are not touched.</p>
        {game.mods.files > 0 && <Switch checked={reapply} onChange={setReapply} label="Re-apply my mods" hint="Off moves your mod files aside instead of applying them to the fresh install." />}
      </Sheet>

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
