import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { GuideReader, type ReaderHandle } from '../components/guide/Reader'
import '../components/guide/Guide.css'
import { Spinner } from '../lantern/ui'
import { useGame } from '../lib/queries'

/**
 * The guide in a window of its own: the page the Pop out button opens where the browser has no Picture-in-Picture
 * window to give (Firefox, Safari). It holds only the reader. Escape closes the window.
 */
export default function GuidePopup() {
  const { id, file: first = '' } = useParams()
  const { data: game, isLoading } = useGame(id)
  const [file, setFile] = useState(first)
  const handle = useRef<ReaderHandle | null>(null)
  const current = game?.walkthroughs.find((w) => w.file === file) ?? game?.walkthroughs[0]
  useEffect(() => {
    document.title = current && game ? `${current.title} · ${game.title}` : 'Guide'
  }, [current, game])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && window.close()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  if (isLoading || !game) return <div className="gw-popup">{isLoading ? <Spinner /> : <p className="small muted">This game was not found.</p>}</div>
  if (!current) return <div className="gw-popup"><p className="small muted">This guide was not found.</p></div>
  return (
    <div className="gw-popup gw-popped">
      <h1 className="gw-popup-title truncate">{current.title}</h1>
      <GuideReader game={game} file={current.file} onFile={setFile} handle={handle} />
    </div>
  )
}
