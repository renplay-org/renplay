import { CloudOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Pill, Bar } from '../lantern/controls'
import type { Game } from '@shared/api'
import { bytes } from '@shared/format'
import { keep, keptGame, offlineSupport, removeKept } from '../lib/offline'
import { isRenpy } from '@shared/family'
import { Confirm, errorText, useToast } from '../lantern/ui'

/** The game's copy in this browser, for playing with no network. Ren'Py games only. */
export default function OfflineCard({ game }: { game: Game }) {
  const toast = useToast()
  const [kept, setKept] = useState(() => keptGame(game.id))
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const stop = useRef<AbortController | null>(null)
  useEffect(() => {
    const update = () => setKept(keptGame(game.id))
    window.addEventListener('renplay:offline', update)
    return () => {
      window.removeEventListener('renplay:offline', update)
      stop.current?.abort()
    }
  }, [game.id])
  if (game.status !== 'installed' || !isRenpy(game)) return null
  const support = offlineSupport()
  const outdated = !!kept && kept.build !== game.build
  const start = async () => {
    const ctl = new AbortController()
    stop.current = ctl
    setProgress({ done: 0, total: 0 })
    try {
      await keep(game, ctl.signal, (done, total) => setProgress({ done, total }))
      toast(`${game.title} is kept in this browser. It plays with no network.`, 'success')
    } catch (e) {
      if (!ctl.signal.aborted) toast(errorText(e), 'error')
    } finally {
      setProgress(null)
      stop.current = null
    }
  }
  return (
    <section className="panel stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <CloudOff size={18} aria-hidden />
        <h2 className="h3">Offline</h2>
      </div>
      {support === 'browser' ? (
        <p className="small muted">This browser cannot keep games for playing offline.</p>
      ) : support === 'home-screen' ? (
        <p className="small muted">To play with no network, add Renplay to your Home Screen (Share, then Add to Home Screen) and keep the game from there. Safari clears what a tab keeps after a week without a visit.</p>
      ) : progress ? (
        <>
          <p className="small muted">
            Keeping it in this browser{progress.total ? `: ${bytes(progress.done)} of ${bytes(progress.total)}` : ''}. Keep this page open.
          </p>
          <Bar value={progress.total ? progress.done / progress.total : 0} indeterminate={!progress.total} />
          <div className="actions">
            <Pill variant="q" size="sm" onClick={() => stop.current?.abort()}>
              Stop
            </Pill>
          </div>
        </>
      ) : kept ? (
        <>
          <p className="small muted">
            {outdated ? 'A copy of an older version is kept in this browser. It still plays offline.' : 'Kept in this browser. It plays with no network, and saves made offline are sent when the server is back.'} {bytes(kept.bytes)}.
          </p>
          <div className="actions">
            {outdated && (
              <Pill variant="s" size="sm" onClick={() => void start()}>
                Update offline copy
              </Pill>
            )}
            <Pill variant="q" size="sm" onClick={() => setConfirm(true)}>
              Remove offline copy
            </Pill>
          </div>
        </>
      ) : (
        <>
          <p className="small muted">Keep this game in this browser to play it with no network. Saves made offline are sent when the server is back.</p>
          <div className="actions">
            <Pill variant="s" size="sm" onClick={() => void start()}>
              Keep offline
            </Pill>
          </div>
        </>
      )}
      <Confirm
        open={confirm}
        title="Remove the offline copy?"
        confirmLabel="Remove"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false)
          await removeKept(game.id)
        }}
      >
        The game stays in your library and plays online. Saves are not touched.
      </Confirm>
    </section>
  )
}
