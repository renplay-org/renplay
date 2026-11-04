import Sheet from './Sheet'
import SceneCard from './SceneCard'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, FileArchive, History, MoreHorizontal, Play, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, del, post, slotName, type Game, type SaveSlot } from '../lib/api'
import { ago, bytes, dateTime, duration } from '../lib/format'
import { useGames, useSaves } from '../lib/queries'
import { Badge, Button, Confirm, Empty, MenuItem, Modal, Spinner, cx, errorText, useToast } from './ui'

type Kind = 'all' | 'manual' | 'auto' | 'quick'

export default function SaveGallery({ game }: { game: Game }) {
  const { data, isLoading } = useSaves(game.id)
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<Kind>('all')
  const [importing, setImporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SaveSlot | null>(null)
  const [copying, setCopying] = useState<SaveSlot | null>(null)
  const [history, setHistory] = useState<SaveSlot | 'all' | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['saves', game.id] })
    void qc.invalidateQueries({ queryKey: ['games'] })
    void qc.invalidateQueries({ queryKey: ['game', game.id] })
  }

  const onImport = async (files: FileList | null) => {
    if (!files?.length) return
    setImporting(true)
    try {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append('files', f, f.name)
      const res = await fetch(`/api/saves/${game.id}/import`, { method: 'POST', body: fd })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error || 'Import failed')
      const parts = [`Imported ${r.imported.length} file${r.imported.length === 1 ? '' : 's'}`]
      if (r.trustedKeys) parts.push(`trusted ${r.trustedKeys} device key${r.trustedKeys === 1 ? '' : 's'}`)
      if (r.skipped.length) parts.push(`skipped ${r.skipped.length}: ${r.skipped.map((s: any) => s.reason).join('; ')}`)
      toast(parts.join(', '), r.imported.length ? 'success' : 'error')
      refresh()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!game.saveDir)
    return (
      <Empty title="Save folder not known yet">
        Start the game once; renplay learns where it saves from Ren’Py itself. You can also set it in the Details tab.
      </Empty>
    )

  const slots = (data?.slots ?? []).filter((s) => s.kind !== 'internal' && (kind === 'all' || s.kind === kind))
  const counts = (data?.slots ?? []).reduce<Record<string, number>>((m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m), {})

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.06]">
          {(['all', 'manual', 'auto', 'quick'] as Kind[]).map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cx('rounded-lg px-3 py-1.5 text-[13px] font-medium capitalize transition-colors', kind === k ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-zinc-200')}>
              {k}
              {k !== 'all' && counts[k] ? <span className="ml-1.5 text-zinc-500">{counts[k]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <input ref={fileRef} type="file" multiple accept=".save,.zip,application/zip" className="hidden" onChange={(e) => void onImport(e.target.files)} />
          <Button size="sm" icon={<Upload className="size-4" />} loading={importing} onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <a href={`/api/saves/${game.id}/export`}>
            <Button size="sm" icon={<FileArchive className="size-4" />}>
              Export all
            </Button>
          </a>
          <Button size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setHistory('all')}>
            History
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !slots.length ? (
        <Empty title="No saves yet">
          Saves you make in the game are stored on the server as soon as you make them. You can also import saves from the desktop version (single <code>.save</code> files or a zip of the save folder).
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {slots.map((s) => (
            <div key={s.file} className="group overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.08] transition hover:ring-white/20">
              <button
                className="relative block aspect-video w-full overflow-hidden bg-ink-800"
                onClick={() => game.playUrl && navigate(`/play/${game.id}?resume=${encodeURIComponent(slotName(s.file))}`)}
                disabled={!game.playUrl}
                title={game.playUrl ? 'Load this save' : 'Install the game to load saves'}
              >
                <SceneCard game={game} save={s} className="size-full rounded-none" />
                {game.playUrl && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="flex size-11 items-center justify-center rounded-full bg-white text-black">
                      <Play className="ml-0.5 size-5 fill-black" />
                    </span>
                  </span>
                )}
                <Badge tone={s.kind === 'manual' ? 'neutral' : s.kind === 'auto' ? 'violet' : 'accent'} className="glass absolute left-2 top-2">
                  {s.label}
                </Badge>
              </button>
              <div className="flex items-start gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-100">{s.name || <span className="text-zinc-400">Untitled</span>}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500" title={dateTime(s.ctime)}>
                    {ago(s.ctime)}
                    {duration(s.runtime) ? ` · ${duration(s.runtime)} played` : ''}
                  </div>
                </div>
                <Sheet
                  trigger={(toggle) => (
                    <button onClick={toggle} className="-mr-1 flex size-11 shrink-0 items-center justify-center rounded-lg p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200" aria-label="Save actions">
                      <MoreHorizontal className="size-4" />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem icon={<Play />} disabled={!game.playUrl} onClick={() => { close(); navigate(`/play/${game.id}?resume=${encodeURIComponent(slotName(s.file))}`) }}>Load</MenuItem>
                      <MenuItem icon={<Download />} onClick={() => (close(), window.open(`/api/saves/${game.id}/download?file=${encodeURIComponent(s.file)}`))}>
                        Download
                      </MenuItem>
                      <MenuItem icon={<Copy />} onClick={() => (close(), setCopying(s))}>
                        Copy to another game…
                      </MenuItem>
                      <MenuItem icon={<History />} onClick={() => (close(), setHistory(s))}>
                        Previous versions
                      </MenuItem>
                      <MenuItem icon={<Trash2 />} danger onClick={() => (close(), setConfirmDelete(s))}>
                        Delete
                      </MenuItem>
                    </>
                  )}
                </Sheet>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-500">
        Every save is stored on the server. Overwrites and deletes keep a previous version you can restore from History.
      </p>

      <Confirm
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete save?"
        danger
        confirmLabel="Delete"
        onConfirm={async () => {
          const s = confirmDelete!
          setConfirmDelete(null)
          try {
            await del(`/api/saves/${game.id}/slot?file=${encodeURIComponent(s.file)}`)
            toast('Save deleted. It can be restored from History.', 'success')
            refresh()
          } catch (e) {
            toast(errorText(e), 'error')
          }
        }}
      >
        {confirmDelete?.name || confirmDelete?.label} will be removed from the game. A copy stays in the save history.
      </Confirm>

      {copying && <CopyDialog game={game} slot={copying} onClose={() => setCopying(null)} />}
      {history && <HistoryDialog game={game} file={history === 'all' ? undefined : history.file} onClose={() => setHistory(null)} onRestored={refresh} />}
    </div>
  )
}

function CopyDialog({ game, slot, onClose }: { game: Game; slot: SaveSlot; onClose: () => void }) {
  const { data: games } = useGames()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const targets = (games ?? []).filter((g) => g.id !== game.id && g.saveDir)
  return (
    <Modal open onClose={onClose} title="Copy save to another game">
      <p className="mb-4 text-sm text-zinc-400">
        For sequels that continue from an earlier season. The save keeps its slot if it is free, otherwise it goes into the next free slot.
      </p>
      <div className="space-y-2">
        {targets.length === 0 && <p className="text-sm text-zinc-500">No other game with a known save folder.</p>}
        {targets.map((g) => (
          <button
            key={g.id}
            disabled={!!busy}
            onClick={async () => {
              setBusy(g.id)
              try {
                const r = await post<{ file: string }>(`/api/saves/${game.id}/copy`, { file: slot.file, target: g.id })
                toast(`Copied to ${g.title} as ${r.file}`, 'success')
                onClose()
              } catch (e) {
                toast(errorText(e), 'error')
              } finally {
                setBusy(null)
              }
            }}
            className="flex w-full items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3 text-left text-sm ring-1 ring-white/10 hover:bg-white/[0.08]"
          >
            <span>{g.title}</span>
            {busy === g.id ? <Spinner className="size-4" /> : <span className="text-xs text-zinc-500">{g.saveDir}</span>}
          </button>
        ))}
      </div>
    </Modal>
  )
}

function HistoryDialog({ game, file, onClose, onRestored }: { game: Game; file?: string; onClose: () => void; onRestored: () => void }) {
  const toast = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['history', game.id, file],
    queryFn: () => api<{ versions: Array<{ id: string; name: string; size: number; savedAt: number; reason: string }> }>(`/api/saves/${game.id}/history${file ? `?file=${encodeURIComponent(file)}` : ''}`),
  })
  const reason = (r: string) =>
    ({ overwrite: 'Replaced in game', game: 'Replaced in game', 'game-delete': 'Deleted in game', 'user-delete': 'Deleted here', import: 'Replaced by import', restore: 'Before a restore', copy: 'Replaced by a copy' })[r] ?? r
  return (
    <Modal open onClose={onClose} title={file ? `Previous versions of ${file}` : 'Save history'} wide fullPhone>
      {isLoading ? (
        <Spinner />
      ) : !data?.versions.length ? (
        <p className="text-sm text-zinc-400">No previous versions yet.</p>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {data.versions.slice(0, 200).map((v) => (
            <div key={v.id} className="flex items-center gap-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate text-zinc-100">{v.name}</div>
                <div className="text-xs text-zinc-500">
                  {reason(v.reason)} · {dateTime(v.savedAt)} · {bytes(v.size)}
                </div>
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await post(`/api/saves/${game.id}/history/restore`, { id: v.id })
                    toast(`Restored ${v.name}`, 'success')
                    onRestored()
                  } catch (e) {
                    toast(errorText(e), 'error')
                  }
                }}
              >
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
