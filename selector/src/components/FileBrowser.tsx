import Sheet from './Sheet'
import { deviceHeaders } from '../lib/device'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderUp,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  RotateCcw,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react'
import { Suspense, lazy, useRef, useState } from 'react'
import { api, del, post, type FileEntry, type Game } from '../lib/api'
import { bytes } from '../lib/format'
import { useFiles, useJobs } from '../lib/queries'
import { Badge, Button, Confirm, Empty, MenuItem, Modal, Progress, Spinner, cx, errorText, useToast } from './ui'

const CodeEditor = lazy(() => import('./CodeEditor'))

const stateBadge = {
  added: <Badge tone="green">Added</Badge>,
  modified: <Badge tone="amber">Modified</Badge>,
  deleted: <Badge tone="red">Hidden</Badge>,
  base: null,
}

export default function FileBrowser({ game }: { game: Game }) {
  const [dir, setDir] = useState('game')
  const { data, isLoading, error } = useFiles(game.id, dir)
  const { data: jobs } = useJobs()
  const qc = useQueryClient()
  const toast = useToast()
  const uploadRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<{ path: string; isNew?: boolean } | null>(null)
  const [newName, setNewName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['files', game.id] })
    void qc.invalidateQueries({ queryKey: ['game', game.id] })
    void qc.invalidateQueries({ queryKey: ['games'] })
  }
  const applyJob = jobs?.jobs.find((j) => j.game === game.id && j.type === 'apply-mods' && (j.status === 'running' || j.status === 'queued'))
  const lastApply = jobs?.jobs.find((j) => j.game === game.id && j.type === 'apply-mods')
  const mods = data?.mods
  const changed = (mods?.files ?? 0) + (mods?.deleted ?? 0)
  const pending = !!mods && changed > 0 && !mods.applied

  const upload = async (files: FileList | null, extract: boolean) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('dir', dir)
      fd.append('extract', extract ? '1' : '0')
      fd.append('paths', JSON.stringify(Array.from(files).map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)))
      for (const f of Array.from(files)) fd.append('files', f, f.name)
      const res = await fetch(`/api/games/${game.id}/files/upload`, { method: 'POST', body: fd })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error)
      toast(`Added ${r.written.length} file${r.written.length === 1 ? '' : 's'} to your mods`, 'success')
      refresh()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setUploading(false)
      if (uploadRef.current) uploadRef.current.value = ''
      if (zipRef.current) zipRef.current.value = ''
    }
  }

  const apply = async () => {
    try {
      await post(`/api/games/${game.id}/files/apply`)
      toast('Applying mods…', 'info')
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  if (game.status !== 'installed') return <Empty title="Not installed">Install the game to browse and mod its files.</Empty>

  const crumbs = dir.split('/')

  return (
    <div>
      {changed > 0 && (
        <div className={cx('mb-5 flex flex-wrap items-center gap-4 rounded-2xl px-5 py-4 ring-1 ring-inset', pending ? 'bg-amber-500/[0.08] ring-amber-500/25' : 'bg-violet-500/[0.08] ring-violet-500/25')}>
          <Wand2 className={cx('size-5 shrink-0', pending ? 'text-amber-300' : 'text-violet-300')} />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-zinc-100">
              {changed} file{changed === 1 ? '' : 's'} changed · {pending ? 'Ready to apply' : 'Applied'}
            </div>
            <div className="text-xs text-zinc-400">
              Apply to build a modded version; the original stays. Your edits are kept separately from the game.
            </div>
          </div>
          {applyJob ? (
            <div className="w-48">
              <div className="mb-1 text-xs text-zinc-300">{applyJob.stage || 'Applying'}…</div>
              <Progress value={applyJob.progress} indeterminate={applyJob.status === 'queued'} />
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setConfirmReset(true)}>
                Remove all mods
              </Button>
              {pending && (
                <Button size="sm" variant="primary" icon={<Wand2 className="size-4" />} onClick={apply}>
                  Apply changes
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {lastApply?.status === 'failed' && !applyJob && (
        <div className="mb-5 rounded-2xl bg-red-500/[0.08] px-5 py-3 text-sm text-red-200 ring-1 ring-inset ring-red-500/25">Applying mods failed: {lastApply.error}</div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 text-zinc-600" />}
              <button onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))} className={cx('rounded-md px-1.5 py-0.5 hover:bg-white/10', i === crumbs.length - 1 ? 'text-white' : 'text-zinc-400')}>
                {c}
              </button>
            </span>
          ))}
        </nav>
        <input ref={uploadRef} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files, false)} />
        <input ref={zipRef} type="file" accept=".zip" className="hidden" onChange={(e) => void upload(e.target.files, true)} />
        <Button size="sm" icon={<FilePlus2 className="size-4" />} onClick={() => setNewName('')}>
          New file
        </Button>
        <Button size="sm" icon={<Upload className="size-4" />} loading={uploading} onClick={() => uploadRef.current?.click()}>
          Upload here
        </Button>
        <Button size="sm" icon={<PackagePlus className="size-4" />} onClick={() => zipRef.current?.click()}>
          Install mod zip
        </Button>
      </div>

      <div className="overflow-hidden rounded-2xl ring-1 ring-white/[0.08]">
        {isLoading ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-red-300">{errorText(error)}</div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {dir !== 'game' && (
              <button onClick={() => setDir(crumbs.slice(0, -1).join('/'))} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-zinc-400 hover:bg-white/[0.04]">
                <FolderUp className="size-4" /> ..
              </button>
            )}
            {data?.dirs.map((d) => (
              <button key={d.path} onClick={() => setDir(d.path)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/[0.04]">
                <Folder className="size-4 text-accent-300/80" />
                <span className="flex-1 truncate text-zinc-100">{d.name}</span>
                {d.changed && <Badge tone="amber">Changed</Badge>}
                <span className="text-xs text-zinc-500">{d.count} files</span>
              </button>
            ))}
            {data?.files.map((f) => (
              <FileRow key={f.path} game={game} file={f} onEdit={() => setEditing({ path: f.path })} onChanged={refresh} />
            ))}
            {!data?.dirs.length && !data?.files.length && <div className="p-6 text-sm text-zinc-500">Empty folder.</div>}
          </div>
        )}
      </div>
      <p className="mt-4 text-xs text-zinc-500">
        Files from the game are read-only originals; anything you add, edit or hide is stored as your mod layer and applied on top. Scripts are compiled when you apply.
      </p>

      <Modal
        open={newName !== null}
        onClose={() => setNewName(null)}
        title="New file"
        footer={
          <Button
            variant="primary"
            disabled={!newName?.trim()}
            onClick={() => {
              const p = `${dir}/${newName!.trim().replace(/^\/+/, '')}`
              setNewName(null)
              setEditing({ path: p, isNew: true })
            }}
          >
            Create
          </Button>
        }
      >
        <label className="mb-2 block text-xs text-zinc-400">File name in {dir}/</label>
        <input
          autoFocus
          value={newName ?? ''}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="zz_my_mod.rpy"
          className="h-10 w-full rounded-xl bg-white/[0.05] px-3 text-sm text-white ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-accent-400/60"
        />
      </Modal>

      {editing && <EditorDialog game={game} path={editing.path} isNew={editing.isNew} onClose={() => setEditing(null)} onSaved={refresh} />}

      <Confirm
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        danger
        title="Remove all mods?"
        confirmLabel="Remove mods"
        onConfirm={async () => {
          setConfirmReset(false)
          try {
            await post(`/api/games/${game.id}/files/reset`)
            toast('Restoring the original files…', 'info')
            refresh()
          } catch (e) {
            toast(errorText(e), 'error')
          }
        }}
      >
        The game goes back to its original files. Your mod files are moved aside on the server, not deleted.
      </Confirm>
    </div>
  )
}

function FileRow({ game, file, onEdit, onChanged }: { game: Game; file: FileEntry; onEdit: () => void; onChanged: () => void }) {
  const toast = useToast()
  const replaceRef = useRef<HTMLInputElement>(null)
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn()
      toast(msg, 'success')
      onChanged()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  const raw = `/api/games/${game.id}/files/raw?path=${encodeURIComponent(file.path)}`
  return (
    <div className={cx('flex items-center gap-3 px-4 py-2 text-sm', file.state === 'deleted' && 'opacity-50')}>
      {file.text ? <FileText className="size-4 text-zinc-400" /> : <File className="size-4 text-zinc-500" />}
      <button onClick={file.text && file.state !== 'deleted' ? onEdit : undefined} className={cx('min-w-0 flex-1 truncate text-left', file.text ? 'text-zinc-100 hover:underline' : 'text-zinc-300', file.state === 'deleted' && 'line-through')}>
        {file.name}
      </button>
      {file.state && stateBadge[file.state]}
      <span className="w-20 text-right text-xs tabular-nums text-zinc-500">{bytes(file.size)}</span>
      <input
        ref={replaceRef}
        type="file"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          await run(() => api(raw, { method: 'PUT', body: f }), `Replaced ${file.name}`)
        }}
      />
      <Sheet
        trigger={(toggle) => (
          <button onClick={toggle} className="flex size-11 items-center justify-center rounded-lg p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200" aria-label="File actions">
            <MoreHorizontal className="size-4" />
          </button>
        )}
      >
        {(close) => (
          <>
            {file.text && file.state !== 'deleted' && (
              <MenuItem icon={<Pencil />} onClick={() => (close(), onEdit())}>
                Edit
              </MenuItem>
            )}
            <MenuItem icon={<Download />} onClick={() => (close(), window.open(raw + '&download=1'))}>
              Download
            </MenuItem>
            <MenuItem icon={<Upload />} onClick={() => (close(), replaceRef.current?.click())}>
              Replace…
            </MenuItem>
            {file.state !== 'base' && (
              <MenuItem icon={<Undo2 />} onClick={() => (close(), void run(() => post(`/api/games/${game.id}/files/revert`, { path: file.path }), 'Reverted to the original'))}>
                {file.state === 'added' ? 'Remove my file' : 'Revert to original'}
              </MenuItem>
            )}
            {file.state === 'base' || file.state === 'modified' ? (
              <MenuItem icon={<EyeOff />} danger onClick={() => (close(), void run(() => del(raw), 'File hidden from the game'))}>
                Hide from game
              </MenuItem>
            ) : file.state === 'deleted' ? (
              <MenuItem icon={<Eye />} onClick={() => (close(), void run(() => post(`/api/games/${game.id}/files/revert`, { path: file.path }), 'File restored'))}>
                Unhide
              </MenuItem>
            ) : null}
          </>
        )}
      </Sheet>
    </div>
  )
}

function EditorDialog({ game, path, isNew, onClose, onSaved }: { game: Game; path: string; isNew?: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [text, setText] = useState<string | null>(isNew ? '' : null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const raw = `/api/games/${game.id}/files/raw?path=${encodeURIComponent(path)}`
  if (text === null) {
    void fetch(raw, { headers: deviceHeaders() })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setText)
      .catch((e) => {
        toast(errorText(e), 'error')
        onClose()
      })
  }
  const save = async () => {
    if (text === null) return
    setSaving(true)
    try {
      await api(raw, { method: 'PUT', body: new Blob([text], { type: 'text/plain' }) })
      setDirty(false)
      toast('Saved to your mods. Apply changes to use it in the game.', 'success')
      onSaved()
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      open
      wide="xl"
      fullPhone
      onClose={() => (!dirty || confirm('Discard unsaved changes?')) && onClose()}
      title={<span className="font-mono text-[13px]">{path}</span>}
      footer={
        <>
          <span className="mr-auto text-xs text-zinc-500">{dirty ? 'Unsaved changes · ⌘S to save' : 'Saved'}</span>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" loading={saving} disabled={!dirty && !isNew} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="h-[65vh]">
        {text === null ? (
          <Spinner />
        ) : (
          <Suspense fallback={<Spinner />}>
            <CodeEditor
              value={text}
              language={/\.(rpy|rpym|py)$/i.test(path) ? 'python' : 'text'}
              onChange={(v) => {
                setText(v)
                setDirty(true)
              }}
              onSave={save}
            />
          </Suspense>
        )}
      </div>
    </Modal>
  )
}
