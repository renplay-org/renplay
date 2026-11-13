import { Share, Smartphone, SquarePlus, X } from 'lucide-react'
import DocsLink from '../../components/DocsLink'
import { IconBtn } from '../../lantern/controls'
import { cx } from '../../lantern/ui'

export function SidePanel({ title, onClose, children, top, narrow }: { title: string; onClose: () => void; children: React.ReactNode; top: number; narrow?: boolean }) {
  return (
    <div className="absolute inset-0 z-40" style={{ top }}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className={cx('safe-x safe-bottom absolute bg-ink-900/95 backdrop-blur-xl bottom-0 right-0 max-h-[85%] sm:max-h-none sm:top-0 flex w-full animate-rise flex-col rounded-t-3xl sm:rounded-none border-l border-white/10', narrow ? 'sm:w-96' : 'sm:w-[440px]')}>
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <IconBtn label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconBtn>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-5 pb-6">{children}</div>
      </aside>
    </div>
  )
}

export function HomeScreenHelp() {
  return (
    <div className="space-y-4 text-sm text-zinc-300">
      <p>Safari on iPhone only lets videos go full screen. Renplay can fill the whole screen when you open it from your home screen:</p>
      <DocsLink path="guides/playing/">Playing on iPhone</DocsLink>
      <ol className="space-y-3">
        <li className="flex items-center gap-3">
          <Share className="size-5 shrink-0 text-accent-300" />
          <span>Tap the Share button in Safari.</span>
        </li>
        <li className="flex items-center gap-3">
          <SquarePlus className="size-5 shrink-0 text-accent-300" />
          <span>Choose Add to Home Screen.</span>
        </li>
        <li className="flex items-center gap-3">
          <Smartphone className="size-5 shrink-0 rotate-90 text-accent-300" />
          <span>Open Renplay from the home screen and hold the phone sideways.</span>
        </li>
      </ol>
      <p className="text-zinc-400">Saves are on the server, so you continue where you left off on any device.</p>
    </div>
  )
}
