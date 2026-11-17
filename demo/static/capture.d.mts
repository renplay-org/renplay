export const ENGINES: string
export function trimCatalog<T extends { games: Array<Record<string, any>> }>(catalog: T): T
export function capture(options: { base: string; embedder: string; fetch?: typeof fetch }): Promise<{
  snapshot: { routes: Record<string, unknown>; me: Record<string, any>; games: Array<Record<string, any>> }
  art: string[]
  fetchArt: (path: string) => Promise<Buffer>
  pages: Array<{ id: string; build: string; html: string }>
  runtime: Buffer | null
}>
