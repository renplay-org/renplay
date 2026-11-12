import './Keycap.css'

/** What a layout prints above the character a key types, for the keys Renplay uses. Unknown keys show one character. */
const SHIFTED: Record<string, string> = { '`': '~', '\\': '|', '^': '°', '²': '³', '§': '±', '#': '~', '<': '>' }

/** Accents and the grave sit at the top of their line: the cap lowers them so they sit in the middle of their half. */
const HIGH = '`^´¨°'

/**
 * A key as it looks on the keyboard: the layout's own character, with what Shift types above it where that
 * is known (`~` over a backquote). Decoration only: the text around it says what the key does.
 */
export function Keycap({ char }: { char: string }) {
  const above = SHIFTED[char]
  return (
    <kbd className="keycap" aria-hidden="true">
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
