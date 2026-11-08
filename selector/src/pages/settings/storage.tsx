import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HardDrive } from 'lucide-react'
import { useState } from 'react'
import { Button, Confirm, Modal, Progress, Spinner, errorText, useToast } from '../../components/ui'
import { SourceLabel, LanternSwitch } from '../../lantern/controls'
import { api, del, post, put } from '../../lib/api'
import { bytes } from '@shared/format'
import { useSystem } from '../../lib/queries'
import type { StorageReport } from '@shared/api'
import { Setting, setBy, useRun } from './common'

function DiskBar({ label, disk }: { label: string; disk: { total: number; free: number } | null }) {
  if (!disk) return null
  const used = disk.total - disk.free
  return (
    <div>
      <div className="row between small" style={{ marginBottom: 6 }}>
        <span className="muted-2">{label}</span>
        <span className="muted">
          {bytes(disk.free)} free of {bytes(disk.total)}
        </span>
      </div>
      <Progress value={used / disk.total} />
    </div>
  )
}

/** The volumes, the library's size, where things are kept, and keeping downloads. */
export function StoragePanel() {
  const { data: sys } = useSystem()
  const [storageOpen, setStorageOpen] = useState(false)
  const run = useRun()
  if (!sys) return null
  return (
    <>
      <section className="panel">
        <h2 className="h3 row" style={{ gap: 8, marginBottom: 12 }}>
          <HardDrive style={{ width: 18, height: 18 }} /> Storage
        </h2>
        <div className="list">
          <div className="stack" style={{ gap: 14 }}>
            <DiskBar label="Games volume" disk={sys.disk.games} />
            <DiskBar label="Data (saves, database)" disk={sys.disk.data} />
            <p className="small muted">
              {sys.library.installed} of {sys.library.games} games installed, {bytes(sys.library.bytes)} in total.
            </p>
            <div>
              <Button size="sm" onClick={() => setStorageOpen(true)}>
                Show what uses space
              </Button>
            </div>
            <div className="stack xs muted" style={{ gap: 4, overflowWrap: 'anywhere' }}>
              {(
                [
                  ['Games', sys.paths.games, 'GAMES_DIR'],
                  ['Downloads', sys.paths.archives, 'ARCHIVES_DIR'],
                  ['Data', sys.paths.data, 'DATA_DIR'],
                ] as const
              ).map(([name, path, variable]) => (
                <div key={name} className="row wrap" style={{ gap: 8 }}>
                  <span>
                    {name} <code>{path}</code>
                  </span>
                  {setBy(sys, variable)}
                </div>
              ))}
            </div>
          </div>
          <Setting
            title="Keep downloads"
            hint="Keep downloads so games can be reinstalled. Off deletes only uploads through Renplay after a successful install. Files copied in are never deleted automatically."
            inline
            source={sys.keepDownloadsLocked ? <SourceLabel kind="server" label="RENPLAY_KEEP_DOWNLOADS" /> : <SourceLabel kind={sys.keepDownloadsChosen ? 'here' : 'def'} />}
          >
            {!sys.keepDownloadsLocked ? (
              <LanternSwitch checked={sys.keepDownloads} label="Keep downloads" onChange={(on) => void run(() => put('/api/system/downloads', { keepDownloads: on }), 'Download preference saved')} />
            ) : (
              <span className="xs muted">{sys.keepDownloads ? 'On' : 'Off'}</span>
            )}
          </Setting>
          {sys.purging > 0 && <p className="xs muted">Deleting {sys.purging} removed item{sys.purging === 1 ? '' : 's'} in the background.</p>}
          {sys.orphans.length > 0 && <p className="xs amber">Folders in the games folder that belong to no game: {sys.orphans.join(', ')}. Renplay leaves them alone.</p>}
        </div>
      </section>
      {storageOpen && <StorageSheet onClose={() => setStorageOpen(false)} />}
    </>
  )
}

/** What uses space, game by game, and what Renplay can free. */
function StorageSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['storage'], queryFn: () => api<StorageReport>('/api/system/storage') })
  const [confirm, setConfirm] = useState<StorageReport['games'][number] | null>(null)
  const refresh = async () => {
    await post('/api/system/storage/refresh')
    await qc.invalidateQueries({ queryKey: ['storage'] })
    void qc.invalidateQueries({ queryKey: ['system'] })
  }
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast(ok, 'success')
      await refresh()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  return (
    <Modal open onClose={onClose} title="What uses space" wide fullPhone>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div className="stack" style={{ gap: 20 }}>
          <p className="small muted">
            Games {bytes(data.totals.builds)}, downloads {bytes(data.totals.downloads)}, engines {bytes(data.totals.engines)}.
            {data.freeable.downloads + data.freeable.engines > 0
              ? ` Up to ${bytes(data.freeable.downloads + data.freeable.engines)} can be freed: downloads of installed games (add them again to reinstall) and engines no game uses.`
              : ''}
          </p>
          <section>
            <h3 className="small" style={{ fontWeight: 650, marginBottom: 6 }}>Games</h3>
            <div className="list tight">
              {data.games.map((g) => (
                <div key={g.id} className="row between wrap" style={{ gap: 8, minHeight: 'var(--hit)', padding: '6px 0' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{g.title}</div>
                    <div className="xs muted">
                      {[
                        g.builds.filter((b) => b.current).map((b) => `game ${bytes(b.bytes)}`)[0],
                        g.builds.some((b) => !b.current) && `other builds ${bytes(g.builds.filter((b) => !b.current).reduce((n, b) => n + b.bytes, 0))}`,
                        g.download && `download ${bytes(g.download.bytes)}`,
                      ]
                        .filter(Boolean)
                        .join(', ') || 'Nothing on disk'}
                    </div>
                  </div>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="small muted tnum">{bytes(g.bytes)}</span>
                    {g.download && g.status === 'installed' && (
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(g)}>
                        Delete download
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
          {data.engines.length > 0 && (
            <section>
              <h3 className="small" style={{ fontWeight: 650, marginBottom: 6 }}>Engines</h3>
              <div className="list tight">
                {data.engines.map((e) => (
                  <div key={e.version} className="row between" style={{ minHeight: 'var(--hit)' }}>
                    <span>
                      Ren’Py {e.version} <span className="xs muted">{e.used ? 'in use' : 'no game uses it'}</span>
                    </span>
                    <span className="small muted tnum">{bytes(e.bytes)}</span>
                  </div>
                ))}
              </div>
              {data.freeable.engines > 0 && (
                <Button size="sm" style={{ marginTop: 8 }} onClick={() => void run(() => post('/api/system/prune'), 'Unused engines removed')}>
                  Remove unused engines
                </Button>
              )}
            </section>
          )}
          {data.orphans.length > 0 && (
            <section>
              <h3 className="small" style={{ fontWeight: 650, marginBottom: 6 }}>Folders of no game</h3>
              <p className="xs muted" style={{ marginBottom: 6 }}>In the games folder but not in the library. Renplay leaves them alone, delete them yourself if you do not need them.</p>
              <div className="list tight">
                {data.orphans.map((o) => (
                  <div key={o.name} className="row between" style={{ minHeight: 'var(--hit)' }}>
                    <code>{o.name}</code>
                    <span className="small muted tnum">{bytes(o.bytes)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      <Confirm
        open={!!confirm}
        onClose={() => setConfirm(null)}
        danger
        title="Delete this download?"
        confirmLabel="Delete download"
        onConfirm={() => {
          const g = confirm!
          setConfirm(null)
          void run(() => del(`/api/games/${g.id}/download`), 'Download deleted')
        }}
      >
        Deletes {confirm?.download?.name}. Reinstalling {confirm?.title} will need the download again. The installed game and its saves are kept.
      </Confirm>
    </Modal>
  )
}
