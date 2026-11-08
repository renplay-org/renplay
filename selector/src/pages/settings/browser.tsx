import { useState } from 'react'
import { Button } from '../../components/ui'
import { DeviceAdultRow } from '../../components/AdultLadder'
import { SourceLabel, LanternSwitch } from '../../lantern/controls'
import { setLighterBackground, useLighterBackground } from '../../lib/backdrop'
import { Setting } from './common'

export function BrowserSettings() {
  return (
    <div className="stack page-col" style={{ gap: 18 }}>
      <h1 className="h1">This browser</h1>
      <section className="panel stack">
        <DeviceAdultRow />
        <LighterBackground />
        <KeepCache />
      </section>
    </div>
  )
}

export function LighterBackground() {
  const { on, from } = useLighterBackground()
  return (
    <Setting
      title="Lighter background"
      hint="A plain background instead of the game’s art behind each screen. It uses less data and battery. Until you choose, it follows this device’s reduced motion and data saver settings."
      inline
      source={<SourceLabel kind={from === 'chosen' ? 'here' : from === 'admin' ? 'admin' : 'def'} />}
    >
      <LanternSwitch checked={on} label="Lighter background" onChange={setLighterBackground} />
    </Setting>
  )
}

export function KeepCache() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  return (
    <Setting title="Keep game cache" hint="Game data (not saves) is cached in the browser so games start instantly the next time. Ask the browser to keep that cache from being cleared automatically.">
      <Button
        size="sm"
        onClick={async () => {
          const ok = (await navigator.storage?.persist?.()) ?? false
          setPersisted(ok)
        }}
      >
        Keep game cache
      </Button>
      {persisted !== null && <span className="xs muted">{persisted ? 'The browser will keep the cache.' : 'The browser declined. It may still keep it.'}</span>}
    </Setting>
  )
}
