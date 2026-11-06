import { useQuery } from '@tanstack/react-query'
import { Copy, Download } from 'lucide-react'
import { api, type Game } from '../lib/api'
import { Button, Modal, Spinner, useToast } from './ui'

/** A recipe for an installed game, filled in from the installation, to contribute to the catalog. */
export default function RecipeDialog({ game, onClose }: { game: Pick<Game, 'id' | 'recipe'>; onClose: () => void }) {
  const toast = useToast()
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['recipe', game.id],
    queryFn: () => api<{ yaml: string; sha256Pending: boolean; hashJob: string | null }>(`/api/games/${game.id}/recipe`),
    refetchInterval: (q) => (q.state.data?.sha256Pending ? 4000 : false),
  })
  const file = `${game.recipe?.id ?? game.id}.yaml`
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Recipe for the catalog"
      footer={
        <>
          <span className="mr-auto text-xs text-zinc-500">{data?.sha256Pending ? 'Computing the archive checksum' : `Save as recipes/${file}`}</span>
          <Button
            variant="ghost"
            icon={<Download className="size-4" />}
            disabled={!data}
            onClick={() => {
              const a = document.createElement('a')
              a.href = URL.createObjectURL(new Blob([data!.yaml], { type: 'text/yaml' }))
              a.download = file
              a.click()
              setTimeout(() => URL.revokeObjectURL(a.href), 1000)
            }}
          >
            Download
          </Button>
          <Button
            variant="primary"
            icon={<Copy className="size-4" />}
            disabled={!data}
            onClick={async () => {
              await navigator.clipboard.writeText(data!.yaml)
              toast('Recipe copied', 'success')
            }}
          >
            Copy
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-zinc-400">
        Filled in from this installation. Add the developer, links and what you tested, set the status, then open a pull request on{' '}
        <a className="text-accent-300 hover:underline" href="https://renplay.org/github/catalog" target="_blank" rel="noreferrer">
          the catalog on GitHub
        </a>
        .
      </p>
      {isLoading ? (
        <Spinner />
      ) : (
        <pre className="max-h-[55vh] overflow-auto rounded-xl bg-black/40 p-4 font-mono text-[12px] leading-relaxed text-zinc-200">{data?.yaml}</pre>
      )}
      {data?.sha256Pending && (
        <button onClick={() => void refetch()} className="mt-2 text-xs text-zinc-500 hover:text-zinc-300">
          Refresh
        </button>
      )}
    </Modal>
  )
}
