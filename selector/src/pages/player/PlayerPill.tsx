import { CloudOff, Expand, Menu } from 'lucide-react'
import type { CSSProperties } from 'react'
import { cx } from '../../lantern/ui'

/**
 * The pill over the game that opens the menu: it says Menu, shows the key on a keyboard or the Menu
 * button while a controller is connected, and is lit for the first five seconds. After the pill, the
 * full screen button, and an amber cloud, with no words, while saves wait for the server.
 */
export default function PlayerPill({
  style,
  fresh,
  keyLabel,
  pad,
  onMenu,
  onFullscreen,
  waiting,
  waitLabel,
}: {
  style: CSSProperties
  fresh: boolean
  /** The key that opens the menu, or null on a touch screen. */
  keyLabel: string | null
  pad: boolean
  onMenu: () => void
  /** Where the device can go full screen. */
  onFullscreen?: () => void
  waiting: boolean
  waitLabel: string
}) {
  return (
    // HTML games often put their own menu in the top left (SugarCube's sidebar toggle): their pills are at the right.
    <div className={cx('rp-pills', fresh && 'fresh')} style={style}>
      <button type="button" className="rp-pill" onClick={onMenu} aria-label={keyLabel && !pad ? `Menu, key ${keyLabel}` : 'Menu'}>
        <span className="mark" aria-hidden="true" />
        Menu
        {pad ? (
          <span className="glyph" aria-hidden="true">
            <Menu />
          </span>
        ) : (
          keyLabel && <kbd aria-hidden="true">{keyLabel}</kbd>
        )}
      </button>
      {onFullscreen && (
        <button type="button" className="rp-pill icon" onClick={onFullscreen} aria-label="Full screen">
          <Expand aria-hidden="true" />
        </button>
      )}
      {waiting && (
        <span className="rp-cloud" role="status" aria-label={waitLabel} title={waitLabel}>
          <CloudOff aria-hidden="true" />
        </span>
      )}
    </div>
  )
}
