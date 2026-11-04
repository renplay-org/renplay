import { useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, FileCode2, HardDrive, Package, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import RecipeDialog from '../components/RecipeDialog'
import { Button, Progress, Spinner, Switch, errorText, useToast } from '../components/ui'
import { post } from '../lib/api'
import { ago, bytes } from '../lib/format'
import { useBlurAdultCovers } from '../lib/prefs'
import { useCatalog, useGames, useSystem } from '../lib/queries'

function DiskBar({ label, disk }: { label: string; disk: { total: number; free: number } | null }) {
  if (!disk) return null
  const used = disk.total - disk.free
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-sm">
        <span className="text-zinc-300">{label}</span>
        <span className="text-zinc-500">
          {bytes(disk.free)} free of {bytes(disk.total)}
        </span>
      </div>
      <Progress value={used / disk.total} />
    </div>
  )
}

export default function Settings() {
  const { data: sys, isLoading } = useSystem()
  const { data: catalog } = useCatalog()
  const { data: games } = useGames()
  const installed = (games ?? []).filter((g) => g.status === 'installed')
  const [section, setSection] = useState('general')
  const [recipeFor, setRecipeFor] = useState('')
  const recipeGame = installed.find((g) => g.id === recipeFor)
  const [recipeOpen, setRecipeOpen] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [blurAdult, setBlurAdult] = useBlurAdultCovers()
  if (isLoading || !sys) return <Spinner />
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast(ok, 'success')
      void qc.invalidateQueries()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  return (
    <div className="animate-fade-in space-y-6">
      <h1 className="font-display text-3xl font-bold tracking-tight text-white">Settings</h1>
      <div className="flex flex-col gap-6 lg:flex-row">
      <nav aria-label="Settings sections" className="flex shrink-0 gap-2 overflow-x-auto lg:w-44 lg:flex-col">{[['general', 'General'], ['browser', 'This browser'], ['about', 'About']].map(([value, label]) => <button key={value} onClick={() => setSection(value)} aria-current={section === value ? 'page' : undefined} className={`min-h-11 shrink-0 rounded-xl px-4 text-left text-sm ${section === value ? 'bg-white/10 text-white' : 'text-zinc-400'}`}>{label}</button>)}<Link className="inline-flex min-h-11 shrink-0 items-center px-4 text-sm text-zinc-400" to="/activity">Activity →</Link></nav>
      <div className="min-w-0 flex-1 space-y-6">
      <div className={section === 'general' ? 'space-y-6' : 'hidden'}>
        <section className="space-y-5 rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]">
          <h2 className="flex items-center gap-2 font-semibold text-white">
            <HardDrive className="size-4" /> Storage
          </h2>
          <DiskBar label="Games volume" disk={sys.disk.games} />
          <DiskBar label="Data (saves, database)" disk={sys.disk.data} />
          <p className="text-sm text-zinc-400">
            {sys.library.installed} of {sys.library.games} games installed, {bytes(sys.library.bytes)} in total.
          </p>
          <div className="space-y-1 text-xs text-zinc-500">
            <div>
              Games <code className="text-zinc-400">{sys.paths.games}</code>
            </div>
            <div>
              Archives <code className="text-zinc-400">{sys.paths.archives}</code>
            </div>
            <div>
              Data <code className="text-zinc-400">{sys.paths.data}</code>
            </div>
          </div>
          {sys.purging > 0 && <p className="text-xs text-zinc-500">Deleting {sys.purging} removed item{sys.purging === 1 ? '' : 's'} in the background.</p>}
          {sys.orphans.length > 0 && (
            <p className="text-xs text-amber-300/90">
              Folders in the games folder that belong to no game: {sys.orphans.join(', ')}. Renplay leaves them alone.
            </p>
          )}
        </section>

        <section className="space-y-4 rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]">
          <h2 className="flex items-center gap-2 font-semibold text-white">
            <Package className="size-4" /> Ren’Py engines
          </h2>
          <p className="text-sm text-zinc-400">
            Games run on the official Ren’Py web engine of a matching version, downloaded the first time a game needs it and shared by all games that use it. Unused engines are removed automatically.
          </p>
          <div className="divide-y divide-white/[0.06] text-sm">
            {sys.engines.installed.length === 0 && <p className="py-2 text-zinc-500">None installed yet.</p>}
            {sys.engines.installed.map((e) => (
              <div key={e.version} className="flex items-center justify-between gap-4 py-2">
                <span className="text-zinc-100">Ren’Py {e.version}</span>
                <span className="min-w-0 break-words text-right text-xs text-zinc-500">
                  {bytes(e.bytes)} · {e.usedBy.length ? installed.filter((g) => g.engine === e.version).map((g) => g.title).join(', ') || 'Games are loading' : 'Unused'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            {sys.engines.available.length ? `Available: ${sys.engines.available.map((e) => e.version).join(', ')}` : 'The engine index is unreachable.'} ·{' '}
            <a className="hover:text-zinc-300" href="https://github.com/renplay-web/engines" target="_blank" rel="noreferrer">
              Engines on GitHub
            </a>
          </p>
          {sys.engines.installed.some((e) => !e.usedBy.length) && (
            <Button size="sm" onClick={() => run(() => post('/api/system/prune'), 'Unused engines removed')}>
              Remove unused engines
            </Button>
          )}
        </section>

        <section className="space-y-4 rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]">
          <h2 className="font-semibold text-white">Saves</h2>
          <p className="text-sm text-zinc-400">
            Every save, autosave and persistent change is stored on the server when the game writes it, with previous versions kept. Export everything as a zip that works with desktop Ren’Py.
          </p>
          <a href="/api/saves-export">
            <Button size="sm" icon={<Download className="size-4" />}>
              Export all saves
            </Button>
          </a>
        </section>

        <section className="space-y-4 rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]">
          <h2 className="font-semibold text-white">Catalog</h2>
          <p className="text-sm text-zinc-400">
            Titles, covers and install settings come from {catalog?.status.count ?? 0} recipes in the catalog
            {catalog?.status.fetchedAt ? `, updated ${ago(catalog.status.fetchedAt, true)}` : ''}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => run(() => post('/api/catalog/refresh'), 'Catalog refreshed')}>
              Refresh catalog
            </Button>
            <a href="https://github.com/renplay-web/catalog" target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost" icon={<ExternalLink className="size-4" />}>
                Catalog on GitHub
              </Button>
            </a>
          </div>
          {installed.length > 0 && (
            <div className="border-t border-white/[0.06] pt-4">
              <p className="mb-3 text-sm text-zinc-400">Add a game to the catalog: export a recipe filled in from its installation, then open a pull request.</p>
              <div className="flex flex-wrap gap-2">
                <select
                  value={recipeFor}
                  onChange={(e) => setRecipeFor(e.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-xl bg-white/[0.05] px-3 text-sm text-zinc-100 ring-1 ring-inset ring-white/10 focus:outline-none focus:ring-accent-400/60 sm:max-w-64"
                >
                  <option value="">Choose a game</option>
                  {installed.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </select>
                <Button size="sm" icon={<FileCode2 className="size-4" />} disabled={!recipeGame} onClick={() => setRecipeOpen(true)}>
                  Export recipe
                </Button>
              </div>
            </div>
          )}
        </section>

        {recipeOpen && recipeGame && <RecipeDialog game={recipeGame} onClose={() => setRecipeOpen(false)} />}

        </div>
        <section className={`${section === 'browser' ? '' : 'hidden'} space-y-4 rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]`}>
          <h2 className="font-semibold text-white">This browser</h2>
          <p className="text-sm text-zinc-400">
            Game data (not saves) is cached in the browser so games start instantly the next time. Ask the browser to keep that cache from being cleared automatically:
          </p>
          <Button
            size="sm"
            onClick={async () => {
              const ok = (await navigator.storage?.persist?.()) ?? false
              setPersisted(ok)
            }}
          >
            Keep game cache
          </Button>
          {persisted !== null && <p className="text-xs text-zinc-500">{persisted ? 'The browser will keep the cache.' : 'The browser declined; it may still keep it.'}</p>}
          <div className="border-t border-white/[0.06] pt-4">
            <Switch checked={blurAdult} onChange={setBlurAdult} label="Hide pictures of adult games" hint="Covers and save pictures in the library, for screens other people can see. Only this browser is affected." />
          </div>
        </section>
        {section === 'about' && <section className="space-y-4 rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]"><h2 className="font-semibold text-white">About Renplay</h2><p className="text-sm text-zinc-400">Version {sys.version} · Made by the Renplay Team</p><p className="text-sm text-zinc-400">Renplay is open source, under the MIT license. Game art belongs to its developers.</p><div className="flex gap-4 text-sm text-accent-300"><a href="https://github.com/renplay-web/renplay" target="_blank" rel="noreferrer">GitHub ↗</a><a href="https://ko-fi.com/janpuc" target="_blank" rel="noreferrer">Support Renplay ↗</a><a href="https://github.com/renplay-web/renplay/blob/main/LICENSE" target="_blank" rel="noreferrer">License ↗</a></div></section>}
      </div>
      </div>
    </div>
  )
}
