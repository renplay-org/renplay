import { useQueryClient } from '@tanstack/react-query'
import { Download, HardDrive, Package, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button, Progress, Spinner, errorText, useToast } from '../components/ui'
import { post } from '../lib/api'
import { bytes } from '../lib/format'
import { useCatalog, useSystem } from '../lib/queries'

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
  const qc = useQueryClient()
  const toast = useToast()
  const [persisted, setPersisted] = useState<boolean | null>(null)
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
      <div className="grid gap-6 lg:grid-cols-2">
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
              Folders in the games folder that belong to no game: {sys.orphans.join(', ')}. renplay leaves them alone.
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
                <span className="truncate text-right text-xs text-zinc-500">
                  {bytes(e.bytes)} · {e.usedBy.length ? e.usedBy.join(', ') : 'unused'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            Available: {sys.engines.available.map((e) => e.version).join(', ') || 'index unreachable'} ·{' '}
            <a className="hover:text-zinc-300" href="https://github.com/renplay-web/engines" target="_blank" rel="noreferrer">
              renplay-web/engines
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
            {catalog?.status.count ?? 0} recipes from {catalog?.status.urls.join(', ')}
            {catalog?.status.fetchedAt ? `, updated ${new Date(catalog.status.fetchedAt).toLocaleString()}` : ''}.
          </p>
          <Button size="sm" icon={<RefreshCw className="size-4" />} onClick={() => run(() => post('/api/catalog/refresh'), 'Catalog refreshed')}>
            Refresh catalog
          </Button>
        </section>

        <section className="space-y-4 rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]">
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
        </section>
      </div>
      <p className="text-xs text-zinc-600">renplay {sys.version}</p>
    </div>
  )
}
