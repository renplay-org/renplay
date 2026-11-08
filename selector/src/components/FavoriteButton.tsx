import { useQueryClient } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { useState } from 'react'
import { api } from '../lib/api'
import type { Game } from '@shared/api'
import { errorText, useToast } from './ui'

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
    <button
      type="button"
      disabled={busy}
      aria-label={game.favoriteAt ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={!!game.favoriteAt}
      className="btn q lg"
      style={game.favoriteAt ? { color: 'var(--pink-2)' } : undefined}
      onClick={() => void toggle()}
    >
      <Heart fill={game.favoriteAt ? 'currentColor' : 'none'} />
    </button>
  )
}
