import { queueHtmlSave, uploadHtmlSave } from '../../lib/html-save-queue'
import { HTML_STORAGE_FILES } from '@shared/html'

/** Who and where, read when a snapshot arrives: the player may move to another game. */
export interface HtmlSaveContext {
  userId: number
  gameId: string
  send: (msg: Record<string, unknown>) => void
  onSignedOut: () => void
}

export interface HtmlSaveKeeper {
  /** Keeps a snapshot of the game's whole storage (localStorage, or IndexedDB as 'idb'). */
  store(saveDir: string, kind: string | undefined, data: string): void
  /** Settles once every snapshot sent so far is kept on this device. */
  kept(): Promise<unknown>
}

/**
 * A sandboxed HTML game's storage, which comes through the player. Each snapshot is kept on this
 * device before the game hears that it is, then uploaded. A stalled upload never delays the next
 * snapshot or its acknowledgement.
 */
export function htmlSaveKeeper(context: () => HtmlSaveContext): HtmlSaveKeeper {
  let write: Promise<unknown> = Promise.resolve()
  let upload: Promise<unknown> = Promise.resolve()
  return {
    store(saveDir, kind, data) {
      const { userId, gameId, send, onSignedOut } = context()
      const path = `${saveDir}/${kind === 'idb' ? HTML_STORAGE_FILES.idb : HTML_STORAGE_FILES.local}`
      write = write
        .catch(() => {})
        .then(async () => {
          const entry = await queueHtmlSave(userId, gameId, path, data)
          send({ type: 'renplay:storage-kept', kind, data, userId })
          upload = upload.catch(() => {})
            .then(() => uploadHtmlSave(entry))
            .catch(onSignedOut)
        })
        .catch(onSignedOut)
    },
    kept: () => write,
  }
}
