import type { ReactNode } from 'react'

export default function ActionBar({ children }: { children: ReactNode }) {
  return <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex gap-3 border-t border-white/10 bg-ink-950/95 p-3 backdrop-blur sm:hidden [&>*]:flex-1 [&_button]:w-full">{children}</div>
}
