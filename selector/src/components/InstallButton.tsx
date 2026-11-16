import { useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import type { Game } from '@shared/api'
import { Pill } from '../lantern/controls'
import { errorText, useToast } from '../lantern/ui'
import { post } from '../lib/api'
import { useAuth } from '../lib/auth'

/** Install on a game that is not installed: an admin's button, or a line that says who to ask. */
export default function InstallButton({ game }: { game: Game }) {
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
