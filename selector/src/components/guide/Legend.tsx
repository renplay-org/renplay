import type { ReactNode } from 'react'
import { Keycap, PadGlyph } from '../../lantern/Keycap'

type Entry = [ReactNode, string]

/** One line of what the keys or the controller's buttons do in the guide, for a computer. A controller shows its own buttons. */
export function Legend({ pad, pdf }: { pad: boolean; pdf: boolean }) {
  const pages: Entry[] = pdf ? [[pad ? <PadGlyph button="left-right" /> : <><Keycap small char="PgUp" /><Keycap small char="PgDn" /></>, 'pages']] : []
  const entries: Entry[] = pad
    ? [...pages, [<PadGlyph button="up-down" />, 'scroll'], [<PadGlyph button="x" />, 'zoom'], [<PadGlyph button="y" />, 'see-through'], [<PadGlyph button="b" />, 'back']]
    : [...pages, [<Keycap small char="+" />, 'zoom'], [<Keycap small char="0" />, 'fit'], [<Keycap small char="Esc" />, 'close']]
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
