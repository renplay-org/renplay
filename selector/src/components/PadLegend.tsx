import { PadGlyph } from '../lantern/Keycap'
import { useGamepadInUse } from '../lib/gamepad'
import './PadLegend.css'

/** What the controller's buttons do on the library's pages, small and in a corner, only while a controller is what is being used. */
export default function PadLegend() {
  if (!useGamepadInUse()) return null
  return (
    <div className="pad-legend" aria-hidden="true">
      <span>
        <PadGlyph button="a" />
        Select
      </span>
      <span>
        <PadGlyph button="b" />
        Back
      </span>
      <span>
        <PadGlyph button="lb" />
        <PadGlyph button="rb" />
        Pages
      </span>
    </div>
  )
}
