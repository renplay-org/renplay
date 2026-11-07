import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Copy, FolderOpen, Laptop } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRoom } from '../lantern/Room'
import { api } from '../lib/api'
import { readZip } from '../lib/zipread'
import { Button, Progress, Spinner, errorText, useToast } from '../components/ui'

interface Index {
  dirs: Record<string, Record<string, { mtime: number; size: number }>>
  games: Record<string, { id: string; title: string }>
  catalog: Record<string, string>
}

/** A file found in the chosen folder or zip, by its path from the Ren'Py folder. */
interface Found {
  rel: string
  size: number
  mtime: number
  read: () => Promise<Blob>
}

type Computer = 'mac' | 'windows' | 'linux'

const FOLDERS: Record<Computer, { name: string; path: string; how: string }> = {
  mac: { name: 'a Mac', path: '~/Library/RenPy', how: 'In the folder window press Shift, Command and G, paste the path, then choose the folder.' },
  windows: { name: 'Windows', path: '%APPDATA%\\RenPy', how: 'Paste the path into the folder window’s address bar, then choose the folder.' },
  linux: { name: 'Linux', path: '~/.renpy', how: 'In the folder window press Control and L, paste the path, then choose the folder.' },
}

function computer(): Computer | null {
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|android/.test(ua) || (ua.includes('mac') && navigator.maxTouchPoints > 1)) return null
  const p = (((navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || ua) as string).toLowerCase()
  return p.includes('mac') ? 'mac' : p.includes('win') ? 'windows' : p.includes('linux') ? 'linux' : null
}

/** Where a file goes: `<save folder>/<file>` for saves and persistent data, the save keys, or nothing. */
function relOf(path: string): string | null {
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.includes('__MACOSX')) return null
  const name = parts[parts.length - 1] ?? ''
  const dir = parts[parts.length - 2]
  if (name === 'security_keys.txt' && dir === 'tokens') return 'tokens/security_keys.txt'
  if (!dir || dir === 'sync' || dir === 'tokens' || !(name.endsWith('.save') || name === 'persistent')) return null
  return `${dir}/${name}`
}

/** The newest copy of each file, by where it goes. */
function collect(items: Array<{ path: string; size: number; mtime: number; read: () => Promise<Blob> }>): Found[] {
  const out = new Map<string, Found>()
  for (const it of items) {
    const rel = relOf(it.path)
    if (!rel) continue
    const had = out.get(rel)
    if (!had || it.mtime > had.mtime) out.set(rel, { rel, size: it.size, mtime: it.mtime, read: it.read })
  }
  return [...out.values()]
}

type State = 'new' | 'newer' | 'older' | 'same'

function compare(index: Index, f: Found): State {
  const [dir, name] = [f.rel.slice(0, f.rel.indexOf('/')), f.rel.slice(f.rel.indexOf('/') + 1)]
  const there = index.dirs[dir]?.[name]
  if (!there) return 'new'
  // Zips keep times in two-second steps.
  if (there.size === f.size && Math.abs(there.mtime - f.mtime) <= 2000) return 'same'
  return f.mtime > there.mtime ? 'newer' : 'older'
}

interface Row {
  dir: string
  title: string | null
  inLibrary: boolean
  files: number
  counts: Record<State, number>
}

function rowsOf(index: Index, found: Found[]): Row[] {
  const rows = new Map<string, Row>()
  for (const f of found) {
    if (f.rel.startsWith('tokens/')) continue
    const dir = f.rel.slice(0, f.rel.indexOf('/'))
    let row = rows.get(dir)
    if (!row) {
      const game = index.games[dir]
      row = { dir, title: game?.title ?? index.catalog[dir] ?? null, inLibrary: !!game, files: 0, counts: { new: 0, newer: 0, older: 0, same: 0 } }
      rows.set(dir, row)
    }
    row.files++
    row.counts[compare(index, f)]++
  }
  return [...rows.values()].sort((a, b) => Number(b.inLibrary) - Number(a.inLibrary) || (a.title ?? a.dir).localeCompare(b.title ?? b.dir))
}

function describe(r: Row): string {
  const parts = []
  if (r.counts.new) parts.push(`${r.counts.new} new`)
  if (r.counts.newer) parts.push(`${r.counts.newer} newer`)
  if (r.counts.older) parts.push(`${r.counts.older} older, kept in History`)
  if (r.counts.same) parts.push(`${r.counts.same} the same`)
  return parts.join(', ')
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Import saves from a computer: find the Ren'Py folder, preview what changes, then import. */
export default function ImportSaves() {
  useRoom({ game: null, quiet: true })
  const qc = useQueryClient()
  const toast = useToast()
  const system = computer()
  const folder = system ? FOLDERS[system] : null
  const index = useQuery({ queryKey: ['saves-import'], queryFn: () => api<Index>('/api/saves-import') })
  const dirInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const [found, setFound] = useState<Found[] | null>(null)
  const [reading, setReading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [done, setDone] = useState<{ added: number; replaced: number; kept: number; same: number; keys: number } | null>(null)

  const chooseFolder = (files: FileList | null) => {
    if (!files?.length) return
    setFound(collect(Array.from(files).map((f) => ({ path: f.webkitRelativePath || f.name, size: f.size, mtime: f.lastModified, read: async () => f }))))
    setDone(null)
  }
  const chooseZip = async (file: File | undefined) => {
    if (!file) return
    setReading(true)
    try {
      setFound(collect((await readZip(file)).map((e) => ({ path: e.name, size: e.size, mtime: e.mtime, read: e.read }))))
      setDone(null)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setReading(false)
      if (zipInput.current) zipInput.current.value = ''
    }
  }

  if (index.isPending) return <Spinner />
  if (index.error) return <p className="muted">{errorText(index.error)}</p>
  const rows = found ? rowsOf(index.data, found) : []
  const send = found ? found.filter((f) => f.rel.startsWith('tokens/') || compare(index.data, f) !== 'same') : []
  const saves = send.filter((f) => !f.rel.startsWith('tokens/')).length
  const keys = send.length > saves

  const run = async () => {
    setProgress(0)
    const total = { added: 0, replaced: 0, kept: 0, same: 0, keys: 0 }
    try {
      // Batches well inside the server's limits on files and bytes per request.
      let batch: Found[] = []
      let bytes = 0
      let sent = 0
      const flush = async () => {
        if (!batch.length) return
        const form = new FormData()
        form.append('meta', JSON.stringify(batch.map((f) => ({ path: f.rel, mtime: f.mtime }))))
        for (const f of batch) form.append('files', await f.read(), f.rel.split('/').pop()!)
        const res = await fetch('/api/saves-import', { method: 'POST', body: form })
        const r = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(r.error || (res.status === 413 ? 'Those files are too large to send at once.' : 'The import failed. Try again.'))
        for (const k of Object.keys(total) as Array<keyof typeof total>) total[k] += r[k] ?? 0
        sent += batch.length
        setProgress(sent / send.length)
        batch = []
        bytes = 0
      }
      for (const f of send) {
        if (batch.length >= 100 || bytes + f.size > 40 << 20) await flush()
        batch.push(f)
        bytes += f.size
      }
      await flush()
      setDone(total)
      setFound(null)
      void qc.invalidateQueries({ queryKey: ['saves-import'] })
      void qc.invalidateQueries({ queryKey: ['saves'] })
      void qc.invalidateQueries({ queryKey: ['games'] })
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 760 }}>
      <header>
        <Link to="/settings" className="link small row" style={{ gap: 6, minHeight: 'var(--hit)', width: 'fit-content' }}>
          <ArrowLeft className="size-4" /> Settings
        </Link>
        <h1 className="h1">Import saves from a computer</h1>
        <p className="muted-2" style={{ marginTop: 8 }}>
          Bring the saves you made in desktop Ren’Py. Choose the Ren’Py save folder and Renplay matches each game.
        </p>
      </header>

      <input
        ref={(el) => {
          dirInput.current = el
          // A folder picker. React has no property for it.
          el?.setAttribute('webkitdirectory', '')
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => chooseFolder(e.target.files)}
      />
      <input ref={zipInput} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => void chooseZip(e.target.files?.[0])} />

      {done ? (
        <section className="panel stack" style={{ gap: 12 }}>
          <h2 className="h3">Saves imported</h2>
          <p className="small muted">
            {[
              done.added && `${plural(done.added, 'new save')} added`,
              done.replaced && `${plural(done.replaced, 'newer save')} took the place of the server’s copy, which is in History`,
              done.kept && `${plural(done.kept, 'older save')} kept in History`,
              done.same && `${plural(done.same, 'save was', 'saves were')} already on the server`,
            ]
              .filter(Boolean)
              .join('. ') || 'Everything was already on the server'}
            .{done.keys ? ' Saves from that computer load without a warning.' : ''}
          </p>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button variant="primary" to="/">
              Library
            </Button>
            <Button onClick={() => setDone(null)}>Import more</Button>
          </div>
        </section>
      ) : !found ? (
        <section className="panel stack" style={{ gap: 16 }}>
          {folder ? (
            <>
              <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <Laptop className="size-5 shrink-0" style={{ marginTop: 2, color: 'var(--violet-2)' }} />
                <div className="stack" style={{ gap: 8, minWidth: 0 }}>
                  <p>This looks like {folder.name}. Ren’Py keeps saves here:</p>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <code className="path-chip">{folder.path}</code>
                    <Button
                      size="sm"
                      icon={<Copy />}
                      onClick={() => void navigator.clipboard?.writeText(folder.path).then(() => toast('Copied', 'success'), () => toast('Select the path and copy it.'))}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="small muted">{folder.how}</p>
                  <p className="xs muted">
                    {(Object.keys(FOLDERS) as Computer[])
                      .filter((k) => k !== system)
                      .map((k) => `On ${FOLDERS[k].name.replace(/^a /, '')} the folder is ${FOLDERS[k].path}.`)
                      .join(' ')}
                  </p>
                </div>
              </div>
              <div className="row wrap" style={{ gap: 8 }}>
                <Button variant="primary" icon={<FolderOpen />} onClick={() => dirInput.current?.click()}>
                  Choose the Ren’Py folder
                </Button>
                <Button loading={reading} onClick={() => zipInput.current?.click()}>
                  Or a zip of it
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>
                This is a task for a computer. The save folder is on the computer where you played, so open this page there. If you have a zip of
                that folder here, you can choose it.
              </p>
              <div>
                <Button loading={reading} onClick={() => zipInput.current?.click()}>
                  Choose a zip
                </Button>
              </div>
            </>
          )}
        </section>
      ) : (
        <section className="panel stack" style={{ gap: 16 }}>
          <div>
            <h2 className="h3">Preview</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              {rows.length
                ? `Found ${plural(rows.length, 'save folder')}. Nothing is written until you import.`
                : 'No Ren’Py saves in what you chose. Choose the Ren’Py folder itself, or a zip of it.'}
            </p>
          </div>
          {rows.length > 0 && (
            <div className="list">
              {rows.map((r) => (
                <div key={r.dir} className="row between wrap" style={{ gap: 4, minHeight: 'var(--hit)', padding: '8px 0' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{r.inLibrary ? r.title : r.title ? `${r.title}, not in your library` : 'Not in your library'}</div>
                    <div className="xs muted truncate">{r.dir}</div>
                  </div>
                  <div className="small muted-2" style={{ textAlign: 'right' }}>
                    {plural(r.files, 'save')}
                    <div className="xs muted">{r.inLibrary ? describe(r) : `${describe(r)}. Stored for later`}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {progress !== null && <Progress value={progress * 100} />}
          <div className="row wrap" style={{ gap: 8 }}>
            {send.length > 0 && (
              <Button variant="primary" loading={progress !== null} onClick={() => void run()}>
                {saves ? `Import ${plural(saves, 'save')}` : 'Import the save keys'}
              </Button>
            )}
            <Button variant="ghost" disabled={progress !== null} onClick={() => setFound(null)}>
              {send.length ? 'Cancel' : 'Back'}
            </Button>
          </div>
          <p className="xs muted">
            Older copies never replace newer ones: they are kept in History. Saves for games you do not have yet wait on the server and appear when
            the game is added.{keys ? ' The computer’s save keys come along, so its saves load without a warning.' : ''}
          </p>
        </section>
      )}
    </div>
  )
}
