import { useQueryClient } from '@tanstack/react-query'
import { Download, FolderSearch, HardDrive, Package, RefreshCw } from 'lucide-react'
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
  const [scanning, setScanning] = useState(false)
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
          <Button
            size="sm"
            icon={<FolderSearch className="size-4" />}
            loading={scanning}
            onClick={async () => {
              setScanning(true)
              await run(() => post('/api/library/scan'), 'Library rescanned')
              setScanning(false)
            }}
          >
            Rescan games folder
          </Button>
        </section>

        <section className="space-y-4 rounded-3xl bg-white/[0.03] p-6 ring-1 ring-white/[0.07]">
          <h2 className="flex items-center gap-2 font-semibold text-white">
            <Package className="size-4" /> Ren’Py
          </h2>
          <p className="text-sm text-zinc-400">
            Games are built with the Ren’Py {sys.sdk.version} SDK. It is downloaded from renpy.org (checksum-verified) the first time it is needed.
          </p>
          <p className="text-sm text-zinc-300">
            Installed: {sys.sdk.installed.length ? sys.sdk.installed.join(', ') : 'not yet'} · shared engines: {sys.engines.length}
          </p>
          {!sys.sdk.installed.includes(sys.sdk.version) && (
            <Button size="sm" onClick={() => run(() => post('/api/system/sdk'), 'Downloading the SDK in the background')}>
              Download SDK now
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
