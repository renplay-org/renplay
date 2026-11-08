import { Play } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import type { Game } from '@shared/api'
import { useAdultView } from '../lib/adult'
import { hashUrl, hue } from '../lantern/art'
import { cx } from './ui'

/** A save's own scene, 16:9, never catalog art. Below Shown, a save picture of an adult game is never requested. */
export default function SceneCard({ game, save, className, play = false, style }: { game: Pick<Game, 'title' | 'nsfw'>; save?: { label: string; screenshot: string | null; screenshotHash?: string | null } | null; className?: string; play?: boolean; style?: CSSProperties }) {
  const view = useAdultView()
  const hidden = !!game.nsfw && view !== 'shown'
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const screenshot = !hidden && save?.screenshot && save.screenshot !== failedSource ? save.screenshot : null
  const h = hue(game.title)
  // Below Shown the server sends only the picture's hash: a soft blur of its colours.
  const blur = hidden ? hashUrl(save?.screenshotHash) : null
  return (
    <div
      className={cx('scene', className)}
      style={{ background: blur ? `center / cover no-repeat url(${blur})` : `linear-gradient(135deg,hsl(${h} 40% 27%),hsl(${(h + 45) % 360} 30% 10%))`, ...style }}
    >
      {screenshot && <img src={screenshot} alt="" loading="lazy" onError={() => setFailedSource(screenshot)} className="real" />}
      <span className="pill dark lbl" style={{ maxWidth: '90%' }}>
        <span className="truncate">{save?.label || game.title}</span>
      </span>
      {play && (
        <span className="big">
          <Play fill="currentColor" />
        </span>
      )}
      {hidden && <span className="hid">Picture blurred at your adult level</span>}
    </div>
  )
}
