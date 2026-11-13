import { ArrowUpRight, Pin } from 'lucide-react'
import type { Game, SaveSlot } from '@shared/api'
import SceneCard from '../../components/SceneCard'
import { Spinner } from '../../lantern/ui'
import { slotName } from '../../lib/format'
import { groupSaves, saveLine, saveName } from '../../lib/saves'
import { useSaves } from '../../lib/queries'

function SaveRow({ game, save, onLoad }: { game: Game; save: SaveSlot; onLoad: (slot: string) => void }) {
  return (
    <button type="button" className="pm-save" onClick={() => onLoad(slotName(save.file))}>
      <SceneCard game={game} save={save} className="pm-thumb" />
      <span className="pm-save-text">
        <span className="pm-save-name">
          {save.pinnedAt && <Pin aria-label="Pinned" />}
          <span className="truncate">{saveName(save)}</span>
        </span>
        <span className="pm-save-line truncate">{save.note || saveLine(save)}</span>
      </span>
    </button>
  )
}

/**
 * The menu's saves: rows that only load, Pinned first when there are pins and then Recent. Everything
 * that changes a save is on the game page, which the last row opens.
 */
export default function SavesView({ game, onLoad, onManage }: { game: Game; onLoad: (slot: string) => void; onManage: () => void }) {
  const { data, isLoading } = useSaves(game.id)
  const { pinned, recent } = groupSaves((data?.slots ?? []).filter((s) => s.kind !== 'internal' && s.valid))
  return (
    <>
      {isLoading && <Spinner />}
      {!isLoading && !pinned.length && !recent.length && <p className="pm-note" style={{ paddingLeft: 12 }}>No saves yet. Saves you make in the game are kept on the server as you make them.</p>}
      {pinned.length > 0 && <h3 className="pm-group">Pinned</h3>}
      {pinned.map((s) => <SaveRow key={s.file} game={game} save={s} onLoad={onLoad} />)}
      {pinned.length > 0 && recent.length > 0 && <h3 className="pm-group">Recent</h3>}
      {recent.map((s) => <SaveRow key={s.file} game={game} save={s} onLoad={onLoad} />)}
      <button type="button" className="pm-row quiet" onClick={onManage}>
        <ArrowUpRight />
        Manage saves on the game page
      </button>
    </>
  )
}
