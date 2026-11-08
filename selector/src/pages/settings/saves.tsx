import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { useState } from 'react'
import { Button, errorText, useToast } from '../../components/ui'
import { SourceLabel, LanternSwitch } from '../../lantern/controls'
import { api, post, put } from '../../lib/api'
import { ago } from '../../lib/format'
import { bytes } from '@shared/format'
import { useSystem } from '../../lib/queries'
import type { BackupInfo } from '@shared/api'
import { Setting, setBy, useRun } from './common'

/** Saves: export and import, sync codes and the backups. */
export function SavesPanel() {
  const { data: sys } = useSystem()
  const run = useRun()
  return (
    <section className="panel">
      <h2 className="h3" style={{ marginBottom: 6 }}>Saves</h2>
      <p className="small muted">Every save, autosave and persistent change is stored on the server when the game writes it, with previous versions kept. Export everything as a zip that works with desktop Ren’Py, or bring in the saves from a computer.</p>
      <div className="row wrap" style={{ marginTop: 12, gap: 8 }}>
        <Button size="sm" icon={<Download />} href="/api/saves-export">
          Export all saves
        </Button>
        <Button size="sm" icon={<Upload />} to="/import-saves">
          Import from a computer
        </Button>
      </div>
      {sys?.sync && (
        <div style={{ marginTop: 16 }}>
          <Setting
            title="Sync codes"
            hint="Let people move a game’s saves to and from desktop or Android Ren’Py with a code, as Ren’Py’s own Upload Sync and Download Sync do. Saves leave this server only when someone asks for a code, encrypted, to Ren’Py’s sync server, which keeps them for an hour."
            inline
            source={<SourceLabel kind={sys.sync.chosen ? 'here' : 'def'} />}
          >
            <LanternSwitch checked={sys.sync.on} label="Sync codes" onChange={(on) => void run(() => put('/api/system/sync', { on }), on ? 'Sync codes are on' : 'Sync codes are off')} />
          </Setting>
        </div>
      )}
      <SaveBackups />
    </section>
  )
}

/** Save backups: a daily zip of everyone's saves, the last few kept, and Back up now. */
export function SaveBackups() {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const { data } = useQuery({ queryKey: ['backups'], queryFn: () => api<BackupInfo>('/api/system/backups') })
  const { data: sys } = useSystem()
  if (!data) return null
  const now = async () => {
    setBusy(true)
    try {
      await post('/api/system/backups')
      toast('Saves backed up', 'success')
      void qc.invalidateQueries({ queryKey: ['backups'] })
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--line)' }} className="stack">
      <h3 style={{ fontWeight: 650 }}>Daily backups</h3>
      {setBy(sys, 'RENPLAY_BACKUP_DIR')}
      {data.dir ? (
        <>
          <p className="small muted">
            A zip of everyone’s saves goes to <code>{data.dir}</code> once a day, and the newest {data.keep} are kept.{' '}
            {data.last ? `The last one was ${ago(data.last)}.` : 'None yet.'} A server that sleeps when idle makes it the next time it runs.
          </p>
          {data.error && <p className="small" style={{ color: 'var(--amber)' }}>The last backup failed: {data.error}</p>}
          {data.files.length > 0 && (
            <div className="list tight">
              {data.files.slice(0, 5).map((f) => (
                <div key={f.name} className="row between small" style={{ minHeight: 'var(--hit)', gap: 12 }}>
                  <span className="muted-2">{new Date(f.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  <span className="row" style={{ gap: 12 }}>
                    <span className="muted tnum">{bytes(f.size)}</span>
                    <a className="link" href={`/api/system/backups/${encodeURIComponent(f.name)}`}>
                      Download
                    </a>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div>
            <Button size="sm" loading={busy || data.running} onClick={() => void now()}>
              Back up now
            </Button>
          </div>
        </>
      ) : (
        <p className="small muted">Save backups are off. Set RENPLAY_BACKUP_DIR to a folder to turn them on.</p>
      )}
    </div>
  )
}
