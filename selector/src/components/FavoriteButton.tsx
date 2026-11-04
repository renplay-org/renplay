import { useQueryClient } from '@tanstack/react-query'
import { Heart } from 'lucide-react'
import { useState } from 'react'
import { api, type Game } from '../lib/api'
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
      disabled={busy}
      aria-label={game.favoriteAt ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={!!game.favoriteAt}
      className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-rose-300"
      onClick={() => void toggle()}
    >
      <Heart className={game.favoriteAt ? 'size-5 fill-current' : 'size-5'} />
    </button>
  )
}
