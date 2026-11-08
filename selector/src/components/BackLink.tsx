import { ArrowLeft } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

/**
 * The way back from a page outside the tab bar, where a phone has no other. With a label it goes
 * to that page. Without one it says Back and goes back in Renplay, or to `to` when the page was
 * opened directly. Desktops have the header and the side navigation instead, unless `desktop`.
 */
export default function BackLink({ to, label, desktop }: { to: string; label?: string; desktop?: boolean }) {
  const navigate = useNavigate()
  // React Router counts this tab's entries: above 0, the previous one is a Renplay page.
  const inRenplay = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0
  return (
    <Link
      to={to}
      className={`back${desktop ? '' : ' hide-desk'}`}
      onClick={(e) => {
        if (label || !inRenplay) return
        e.preventDefault()
        navigate(-1)
      }}
    >
      <ArrowLeft aria-hidden="true" /> {label ?? 'Back'}
    </Link>
  )
}
