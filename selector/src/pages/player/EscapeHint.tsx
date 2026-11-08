
/** How long Chromium wants Esc held (kHoldEscapeTime in exclusive_access_manager.cc). */
const HOLD_ESCAPE_MS = 1500

/** How to leave fullscreen, and while Esc is held, a ring that fills until it does. */
export default function EscapeHint({ held, top }: { held: boolean; top: number }) {
  const r = 9
  const c = 2 * Math.PI * r
  return (
    <div className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4 animate-fade-in" style={{ top }}>
      <div className="flex items-center gap-3 rounded-full bg-black/75 py-2 pl-2.5 pr-4 text-sm text-white ring-1 ring-white/15 backdrop-blur">
        <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-hidden="true">
          <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
          {held && (
            <circle
              key="hold"
              cx="12"
              cy="12"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c}
              style={{ animation: `escape-hold ${HOLD_ESCAPE_MS}ms linear forwards` }}
            />
          )}
        </svg>
        <span>
          {held ? (
            'Keep holding Esc to leave fullscreen'
          ) : (
            <>
              Hold <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-sans text-xs">Esc</kbd> to leave fullscreen. A short press opens the game’s menu.
            </>
          )}
        </span>
      </div>
    </div>
  )
}
