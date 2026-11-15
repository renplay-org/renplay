import { PencilLine } from 'lucide-react'
import { useState } from 'react'
import { Pill } from '../../lantern/controls'

/**
 * Under Save now, for a few seconds after it: Name it opens a small field in place. Enter or Done names the
 * save, Esc closes the field and leaves the save as it was. `onName` says whether the name was kept. `onOpen` is the
 * field opening, which keeps the row for as long as it is open, and `onDone` is the end of it, named or not.
 */
export default function NameIt({ onName, onOpen, onDone }: { onName: (title: string) => Promise<boolean>; onOpen: () => void; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open)
    return (
      <button type="button" className="pm-row quiet" onClick={() => (onOpen(), setOpen(true))}>
        <PencilLine />
        Name it
      </button>
    )
  return (
    <form
      className="pm-name"
      onSubmit={async (e) => {
        e.preventDefault()
        const name = title.trim()
        // Nothing typed leaves the save as it is.
        if (!name) return onDone()
        setBusy(true)
        const kept = await onName(name)
        setBusy(false)
        if (kept) onDone()
      }}
    >
      <input
        className="input"
        aria-label="Name"
        placeholder="Name this save"
        value={title}
        maxLength={80}
        autoFocus
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => setTitle(e.target.value)}
        // Esc closes the field, not the menu.
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          e.stopPropagation()
          onDone()
        }}
      />
      <Pill variant="p" type="submit" loading={busy}>
        Done
      </Pill>
    </form>
  )
}
