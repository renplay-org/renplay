import type { ReactNode } from 'react'
import { Keycap, PadGlyph } from '../../lantern/Keycap'

type Entry = [ReactNode, string]

/**
 * One line of what the keys or the controller's buttons do in the guide, for a computer. A controller shows its own
 * buttons. Pages are for a PDF, and zoom for a PDF or a picture: text has neither.
 */
export function Legend({ pad, kind }: { pad: boolean; kind: 'pdf' | 'image' | 'text' }) {
  const pages: Entry[] = kind === 'pdf' ? [[pad ? <PadGlyph button="left-right" /> : <><Keycap small char="PgUp" /><Keycap small char="PgDn" /></>, 'pages']] : []
  const zoom = kind !== 'text'
  const entries: Entry[] = pad
    ? [...pages, [<PadGlyph button="up-down" />, 'scroll'], ...(zoom ? ([[<PadGlyph button="x" />, 'zoom']] as Entry[]) : []), [<PadGlyph button="y" />, 'see-through'], [<PadGlyph button="b" />, 'back']]
    : [...pages, ...(zoom ? ([[<Keycap small char="+" />, 'zoom'], [<Keycap small char="0" />, 'fit']] as Entry[]) : []), [<Keycap small char="Esc" />, 'close']]
  return (
    <p className="gr-keys" aria-hidden="true">
      {entries.map(([glyph, text]) => (
        <span key={text} className="gr-key">
          {glyph}
          {text}
        </span>
      ))}
    </p>
  )
}
