import { open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../util/fsx.js'

/** One folder an operation moves: a person's saves or History of the entry's folder. */
export interface Move {
  user: number
  sub: 'saves' | 'save-history'
  name: string
}

/**
 * What a deletion or a restore means to do, written before its first rename and removed after its last,
 * so a start after a crash knows which way to put things right. `people` are in the order of the moves, each with
 * the account the person's number was. `attention` is set when a start could not put it right: the entry is then
 * kept, listed and never removed for good while the file is there.
 */
export interface Journal {
  op: 'delete' | 'restore'
  people: Array<{ user: number; account: string; moves: Move[] }>
  attention?: string
}

const FILE = 'journal.json'
export const journalPath = (entry: string): string => join(entry, FILE)

/** Written whole and atomically, and the folder it is in is flushed too, so a crash leaves the old one or the new one. */
export async function writeJournal(entry: string, journal: Journal): Promise<void> {
  await writeFileAtomic(journalPath(entry), JSON.stringify(journal))
  const dir = await open(entry, 'r').catch(() => null)
  await dir?.sync().catch(() => {})
  await dir?.close()
}

/** The journal of an entry, null when there is none. A file that cannot be read or is not a journal throws. */
export async function readJournal(entry: string): Promise<Journal | null> {
  let text: string
  try {
    text = await readFile(journalPath(entry), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  const j = JSON.parse(text) as Journal
  if ((j.op !== 'delete' && j.op !== 'restore') || !Array.isArray(j.people)) throw new Error('not a journal')
  return j
}

export async function removeJournal(entry: string): Promise<void> {
  await unlink(journalPath(entry)).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'ENOENT') throw e
  })
}
