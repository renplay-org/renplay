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
  Plus,
  RotateCcw,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react'
import { Suspense, lazy, useRef, useState } from 'react'
import { api, del, post, type FileEntry, type Game } from '../lib/api'
import { bytes } from '../lib/format'
import { useFiles, useJobs } from '../lib/queries'
import { Button, Confirm, Empty, Menu, MenuItem, Modal, Progress, Spinner, accountInput, cx, errorText, useToast } from './ui'
import { Pill, TagPill } from '../lantern/controls'

const CodeEditor = lazy(() => import('./CodeEditor'))

/** How many rows of one folder show before Show more: a game folder can hold thousands of pictures. */
const PAGE = 200

/**
 * Mods: what changed comes first (with Install mod zip, Apply changes and Remove all mods), then the
 * game's files, folder by folder. Files from the game are read-only originals: what you add, edit or
 * hide is kept apart as your mod layer and applied on top in a new build.
 */
export default function FileBrowser({ game }: { game: Game }) {
  const [dir, setDir] = useState('game')
  const [limit, setLimit] = useState(PAGE)
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
  const open = (next: string) => {
    setDir(next)
    setLimit(PAGE)
  }

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['files', game.id] })
    void qc.invalidateQueries({ queryKey: ['game', game.id] })
    void qc.invalidateQueries({ queryKey: ['games'] })
  }
  const applyJob = jobs?.jobs.find((j) => j.game === game.id && j.type === 'apply-mods' && (j.status === 'running' || j.status === 'queued'))
  const lastApply = jobs?.jobs.find((j) => j.game === game.id && j.type === 'apply-mods')
  const mods = data?.mods
  const edited = mods?.files ?? 0
  const hidden = mods?.deleted ?? 0
  const changed = edited + hidden
  const pending = !!mods && changed > 0 && !mods.applied

  const upload = async (files: FileList | null, extract: boolean) => {
    if (!files?.length) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('dir', extract ? 'game' : dir)
      fd.append('extract', extract ? '1' : '0')
      fd.append('paths', JSON.stringify(Array.from(files).map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)))
      for (const f of Array.from(files)) fd.append('files', f, f.name)
      const res = await fetch(`/api/games/${game.id}/files/upload`, { method: 'POST', body: fd })
      const r = await res.json()
      if (!res.ok) throw new Error(r.error)
      toast(`Added ${r.written.length} ${r.written.length === 1 ? 'file' : 'files'} to your mods. Apply changes to use them in the game.`, 'success')
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
      toast('Applying mods', 'info')
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  if (game.status !== 'installed') return <Empty title="Not installed">Install the game to add mods or change its files.</Empty>

  const crumbs = dir.split('/')
  const rows = [...(data?.dirs ?? []), ...(data?.files ?? [])]

  return (
    <div className="stack files" style={{ gap: 18 }}>
      <input ref={uploadRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files, false)} />
      <input ref={zipRef} type="file" accept=".zip" hidden onChange={(e) => void upload(e.target.files, true)} />

      <section className="panel stack" style={{ gap: 12 }}>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div>
            <h2 className="h3">Mods</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              {!mods
                ? 'Reading the game’s files'
                : changed === 0
                  ? 'No mods. The game plays as its developer made it.'
                  : [edited ? `${edited} ${edited === 1 ? 'file' : 'files'} added or edited` : '', hidden ? `${hidden} hidden` : ''].filter(Boolean).join(', ') + (pending ? '. Not in the game yet.' : '. In the game.')}
            </p>
          </div>
          {!applyJob && (
            <div className="actions">
              {pending && (
                <Pill variant="p" size="sm" icon={<Wand2 />} onClick={() => void apply()}>
                  Apply changes
                </Pill>
              )}
              <Pill variant={pending ? 's' : changed ? 's' : 'p'} size="sm" icon={<PackagePlus />} aria-disabled={uploading} onClick={() => !uploading && zipRef.current?.click()}>
                {uploading ? 'Adding' : 'Install mod zip'}
              </Pill>
              {changed > 0 && (
                <Pill variant="q" size="sm" icon={<RotateCcw />} onClick={() => setConfirmReset(true)}>
                  Remove all mods
                </Pill>
              )}
            </div>
          )}
        </div>
        {applyJob && (
          <div style={{ maxWidth: 420 }}>
            <p className="xs muted" style={{ marginBottom: 6 }}>
              {applyJob.stage || 'Applying'}
            </p>
            <Progress value={applyJob.progress} indeterminate={applyJob.status === 'queued'} />
          </div>
        )}
        {lastApply?.status === 'failed' && !applyJob && <p className="notice red small">Applying mods failed: {lastApply.error}</p>}
        <p className="xs muted">A mod zip goes into the game folder as it is. Apply changes builds a new version of the game with your mods. The original stays, and Remove all mods goes back to it.</p>
      </section>

      <section className="panel stack" style={{ gap: 10 }}>
        <div className="row between" style={{ gap: 8, alignItems: 'center' }}>
          <nav className="crumbs" aria-label="Folder">
            {crumbs.map((c, i) => (
              <span key={i} className="row" style={{ gap: 2, alignItems: 'center', minWidth: 0 }}>
                {i > 0 && <ChevronRight className="sep" aria-hidden="true" />}
                <button type="button" onClick={() => open(crumbs.slice(0, i + 1).join('/'))} aria-current={i === crumbs.length - 1 ? 'location' : undefined}>
                  {c}
                </button>
              </span>
            ))}
          </nav>
          <Menu
            trigger={(toggle) => (
              <button type="button" className="ib plate" aria-label="Add a file here" onClick={toggle}>
                <Plus />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon={<FilePlus2 />} onClick={() => (close(), setNewName(''))}>
                  New file
                </MenuItem>
                <MenuItem icon={<Upload />} onClick={() => (close(), uploadRef.current?.click())}>
                  Upload files here
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <p className="red small">{errorText(error)}</p>
        ) : (
          <div className="frows">
            {dir !== 'game' && (
              <button type="button" className="frow" onClick={() => open(crumbs.slice(0, -1).join('/'))}>
                <FolderUp aria-hidden="true" />
                <span className="n muted">Up to {crumbs[crumbs.length - 2]}</span>
              </button>
            )}
            {rows.slice(0, limit).map((f) =>
              data?.dirs.includes(f) ? (
                <button type="button" key={f.path} className="frow" onClick={() => open(f.path)}>
                  <Folder aria-hidden="true" className="dir" />
                  <span className="n">{f.name}</span>
                  {f.changed && <TagPill tone="amber">Changed</TagPill>}
                  <span className="m">{f.count} {f.count === 1 ? 'file' : 'files'}</span>
                </button>
              ) : (
                <FileRow key={f.path} game={game} file={f} onEdit={() => setEditing({ path: f.path })} onChanged={refresh} />
              ),
            )}
            {!rows.length && <p className="small muted" style={{ padding: 12 }}>This folder is empty.</p>}
            {rows.length > limit && (
              <div style={{ padding: 8 }}>
                <Pill variant="q" size="sm" onClick={() => setLimit(limit + PAGE * 5)}>
                  Show {Math.min(rows.length - limit, PAGE * 5)} more of {rows.length}
                </Pill>
              </div>
            )}
          </div>
        )}
      </section>

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
        <label className="field">
          <span>File name in {dir}</span>
          <input autoFocus value={newName ?? ''} onChange={(e) => setNewName(e.target.value)} placeholder="zz_my_mod.rpy" className={accountInput} />
        </label>
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
            toast('Going back to the original files', 'info')
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

const stateTag = {
  added: <TagPill tone="green">Added</TagPill>,
  modified: <TagPill tone="amber">Edited</TagPill>,
  deleted: <TagPill tone="red">Hidden</TagPill>,
  base: null,
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
  const editable = file.text && file.state !== 'deleted'
  return (
    <div className={cx('frow', file.state === 'deleted' && 'gone')}>
      {file.text ? <FileText aria-hidden="true" /> : <File aria-hidden="true" />}
      {editable ? (
        <button type="button" className="n link-n" onClick={onEdit}>
          {file.name}
        </button>
      ) : (
        <span className="n">{file.name}</span>
      )}
      {file.state && stateTag[file.state]}
      <span className="m tnum">{bytes(file.size)}</span>
      <input
        ref={replaceRef}
        type="file"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (!f) return
          await run(() => api(raw, { method: 'PUT', body: f }), `Replaced ${file.name}`)
        }}
      />
      <Menu
        trigger={(toggle) => (
          <button type="button" onClick={toggle} className="ib" aria-label={`${file.name}, actions`}>
            <MoreHorizontal />
          </button>
        )}
      >
        {(close) => (
          <>
            {editable && (
              <MenuItem icon={<Pencil />} onClick={() => (close(), onEdit())}>
                Edit
              </MenuItem>
            )}
            <MenuItem icon={<Download />} onClick={() => (close(), window.open(raw + '&download=1'))}>
              Download
            </MenuItem>
            <MenuItem icon={<Upload />} onClick={() => (close(), replaceRef.current?.click())}>
              Replace with a file
            </MenuItem>
            {file.state !== 'base' && (
              <MenuItem icon={<Undo2 />} onClick={() => (close(), void run(() => post(`/api/games/${game.id}/files/revert`, { path: file.path }), 'Back to the original'))}>
                {file.state === 'added' ? 'Remove my file' : 'Back to the original'}
              </MenuItem>
            )}
            {file.state === 'base' || file.state === 'modified' ? (
              <MenuItem icon={<EyeOff />} danger onClick={() => (close(), void run(() => del(raw), 'Hidden from the game'))}>
                Hide from the game
              </MenuItem>
            ) : file.state === 'deleted' ? (
              <MenuItem icon={<Eye />} onClick={() => (close(), void run(() => post(`/api/games/${game.id}/files/revert`, { path: file.path }), 'Back in the game'))}>
                Put back in the game
              </MenuItem>
            ) : null}
          </>
        )}
      </Menu>
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
