import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import SceneCard from '../components/SceneCard'
import UpdateCard from '../components/UpdateCard'
import OfflineCard from '../components/OfflineCard'
import { Seg, Stars } from '../lantern/controls'
import { errorText, useToast } from '../lantern/ui'
import { api } from '../lib/api'
import { useStaticDemo } from '../lib/auth'
import type { Game, HistoryPage } from '@shared/api'
import { ago, capitalize, playedTime, timeZone, duration } from '../lib/format'

const STATUS_OPTIONS = [
  { value: 'playing', label: 'Playing' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'dropped', label: 'Dropped' },
  { value: 'finished', label: 'Finished' },
] as const

/** Play: your progress, your status and rating, updates, and the last sessions of this game. */
export function PlayPane({ game, onSaves }: { game: Game; onSaves?: () => void }) {
  const staticDemo = useStaticDemo()
  const qc = useQueryClient()
  const toast = useToast()
  const history = useQuery({ queryKey: ['history', game.id], queryFn: () => api<HistoryPage>(`/api/history?game=${encodeURIComponent(game.id)}&days=30&tz=${encodeURIComponent(timeZone())}`) })
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
                {playedTime(game.playTime, game.saves.count > 0 || !!game.lastPlayedAt)} · {game.saves.count} {game.saves.count === 1 ? 'save' : 'saves'}
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
        {!staticDemo && <OfflineCard game={game} />}
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
