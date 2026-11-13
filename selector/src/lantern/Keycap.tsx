import './Keycap.css'

/** What a layout prints above the character a key types, for the keys Renplay uses. Unknown keys show one character. */
const SHIFTED: Record<string, string> = { '`': '~', '\\': '|', '^': '°', '²': '³', '§': '±', '#': '~', '<': '>' }

/** Accents and the grave sit at the top of their line: the cap lowers them so they sit in the middle of their half. */
const HIGH = '`^´¨°'

/**
 * A key as it looks on the keyboard: the layout's own character, with what Shift types above it where that
 * is known (`~` over a backquote). Decoration only: the text around it says what the key does.
 */
export function Keycap({ char, small }: { char: string; small?: boolean }) {
  const above = SHIFTED[char]
  return (
    <kbd className={small ? 'keycap sm' : 'keycap'} aria-hidden="true">
      {above && <span className="up">{above}</span>}
      <span className={HIGH.includes(char) ? 'hi' : undefined}>{char}</span>
    </kbd>
  )
}

/** A controller's Menu button, drawn as a round button with its three bars. */
export function PadMenuGlyph() {
  return (
    <svg className="pad-menu" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 9h9M7.5 12h9M7.5 15h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

type PadButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'up-down' | 'left-right'

/** A controller's button, drawn as it is printed on it: a lettered disc, a bumper, or the d-pad with the arms it uses lit. */
export function PadGlyph({ button }: { button: PadButton }) {
  if (button === 'up-down' || button === 'left-right') {
    const lit = button === 'up-down'
    return (
      <svg className="pad-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d={lit ? 'M9 3h6v18H9z' : 'M3 9h18v6H3z'} fill="currentColor" opacity="0.55" />
      </svg>
    )
  }
  const bumper = button === 'lb' || button === 'rb'
  return (
    <span className={bumper ? 'pad-glyph bumper' : 'pad-glyph disc'} aria-hidden="true">
      {button.toUpperCase()}
    </span>
  )
}
