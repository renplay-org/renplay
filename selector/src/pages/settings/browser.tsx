import { useState } from 'react'
import { DeviceAdultRow } from '../../components/AdultLadder'
import { useStaticDemo } from '../../lib/auth'
import { SourceLabel, LanternSwitch, Pill } from '../../lantern/controls'
import { setLighterBackground, useLighterBackground } from '../../lib/backdrop'
import { setCardsMove, useCardsMove } from '../../lib/cardmotion'
import { reducedMotion } from '../../lantern/travel'
import { Setting } from './common'
import BackLink from '../../components/BackLink'

export function BrowserSettings() {
  const staticDemo = useStaticDemo()
  return (
    <div className="stack page-col" style={{ gap: 18 }}>
      <BackLink to="/account" label="You" />
      <h1 className="h1">This browser</h1>
      <section className="panel stack">
        {!staticDemo && <DeviceAdultRow />}
        <LighterBackground />
        <CardMotion />
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

export function CardMotion() {
  const on = useCardsMove()
  return (
    <Setting
      title="Move cards with the pointer"
      hint={reducedMotion() ? 'Game tiles lean toward the pointer and lift under it. This device asks for reduced motion, so they stay still.' : 'Game tiles lean toward the pointer and lift under it.'}
      inline
      source={<SourceLabel kind={on ? 'def' : 'here'} />}
    >
      <LanternSwitch checked={on} label="Move cards with the pointer" onChange={setCardsMove} />
    </Setting>
  )
}

export function KeepCache() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  return (
    <Setting title="Keep game cache" hint="Game data (not saves) is cached in the browser so games start instantly the next time. Ask the browser to keep that cache from being cleared automatically.">
      <Pill
        size="sm"
        onClick={async () => {
          const ok = (await navigator.storage?.persist?.()) ?? false
          setPersisted(ok)
        }}
      >
        Keep game cache
      </Pill>
      {persisted !== null && <span className="xs muted">{persisted ? 'The browser will keep the cache.' : 'The browser declined. It may still keep it.'}</span>}
    </Setting>
  )
}
