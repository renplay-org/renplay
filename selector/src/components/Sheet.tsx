import { useState, useSyncExternalStore, type ComponentProps } from 'react'
import { Menu, Modal } from './ui'

const query = '(max-width: 639px)'
function subscribe(callback: () => void) {
  const media = window.matchMedia(query)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

/** Actions stay anchored with a pointer and become an accessible dialog on phones. */
export default function Sheet({ trigger, children, ...rest }: ComponentProps<typeof Menu>) {
  const phone = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
  const [open, setOpen] = useState(false)
  if (!phone) return <Menu trigger={trigger} {...rest}>{children}</Menu>
  return <>{trigger(() => setOpen(true))}<Modal open={open} onClose={() => setOpen(false)} title="Actions"><div className="[&_button]:min-h-11">{children(() => setOpen(false))}</div></Modal></>
}
