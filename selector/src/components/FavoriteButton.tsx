import { useQueryClient } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import type { Game } from '@shared/api'
import { errorText, useToast } from '../lantern/ui'
import { IconBtn } from '../lantern/controls'

export default function FavoriteButton({ game }: { game: Game }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    try {
      await api(`/api/games/${game.id}/favorite`, { method: 'PUT', json: { on: !game.favoriteAt } })
      await qc.invalidateQueries({ queryKey: ['game', game.id] })
      await qc.invalidateQueries({ queryKey: ['games'] })
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <IconBtn
      label={game.favoriteAt ? 'Remove from favourites' : 'Add to favourites'}
      disabled={busy}
      aria-pressed={!!game.favoriteAt}
      style={game.favoriteAt ? { color: 'var(--pink-2)' } : undefined}
      onClick={() => void toggle()}
    >
      <Heart fill={game.favoriteAt ? 'currentColor' : 'none'} />
    </IconBtn>
  )
}
