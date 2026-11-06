import { Play } from 'lucide-react'
import { useState } from 'react'
import type { Game } from '../lib/api'
import { useAdultView } from '../lib/adult'
import { hue } from './GameCard'
import { cx } from './ui'

/** Below Shown, a save picture of an adult game is never requested. */
export default function SceneCard({ game, save, className, play = false }: { game: Pick<Game, 'title' | 'nsfw'>; save?: { label: string; screenshot: string | null } | null; className?: string; play?: boolean }) {
  const view = useAdultView()
  const hidden = !!game.nsfw && view !== 'shown'
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const screenshot = save?.screenshot && save.screenshot !== failedSource ? save.screenshot : null
  const h = hue(game.title)
  return <div className={cx('relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-2xl text-white', className)} style={{ background: `linear-gradient(135deg,hsl(${h} 40% 27%),hsl(${(h + 45) % 360} 30% 10%))` }}>
    {!hidden && screenshot ? <img src={screenshot} alt="" loading="lazy" onError={() => setFailedSource(screenshot)} className="absolute inset-0 size-full object-cover" /> : <>
      <span className="absolute left-2 top-2 max-w-[90%] truncate rounded-full bg-black/25 px-2 py-0.5 text-[11px]">{save?.label || game.title}</span>
      {play && <span className="flex size-14 items-center justify-center rounded-full bg-white text-ink-950"><Play className="ml-1 size-6 fill-current" /></span>}
      <p className={cx('text-center text-[11px] text-white/50', play ? 'absolute inset-x-3 bottom-4' : 'mt-5')}>{hidden ? play ? 'Pictures of adult games are blurred' : 'Picture hidden' : play ? 'Your story is waiting' : 'No picture'}</p>
    </>}
    {play && !hidden && screenshot && <span className="relative flex size-14 items-center justify-center rounded-full bg-white text-black"><Play className="ml-1 size-6 fill-current" /></span>}
  </div>
}
