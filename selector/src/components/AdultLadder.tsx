import { useState } from 'react'
import { Link } from 'react-router-dom'
import { adultLabels, adultLevels, lowestLevel, useAdultState, useDeviceLevel, useSetAdultChoice, type AdultLevel } from '../lib/adult'
import { cx, errorText, Spinner, useToast } from './ui'

/**
 * Three pills, Off, Blurred and Shown. A pill above `max` (the row above) is
 * struck through and cannot be chosen. Without `onChange` the row is fixed.
 */
export function LevelPills({ label, value, max = 'shown', onChange, busy }: { label: string; value: AdultLevel; max?: AdultLevel; onChange?: (level: AdultLevel) => void; busy?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-1.5">
      {adultLevels.map((level) => {
        const above = adultLevels.indexOf(level) > adultLevels.indexOf(max)
        const selected = level === value
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!onChange || above || busy}
            onClick={() => onChange?.(level)}
            className={cx(
              'min-h-11 rounded-full px-3 text-sm font-medium ring-1 transition-colors',
              selected ? 'bg-white text-ink-950 ring-white' : 'bg-white/[0.04] text-zinc-200 ring-white/10',
              selected && above && 'bg-white/25 text-zinc-200 ring-white/20',
              above && 'line-through decoration-2',
              above && !selected && 'text-zinc-500 ring-white/5',
              onChange && !above && !selected && 'hover:bg-white/10',
              (!onChange || above) && 'cursor-default',
            )}
          >
            {adultLabels[level]}
          </button>
        )
      })}
    </div>
  )
}

function Row({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-sm font-medium text-white">{title}</h3>
        <p className="text-xs text-zinc-400">{source}</p>
      </div>
      {children}
    </div>
  )
}

/** What the person sees and which layer decides it, in one sentence. */
function summary(levels: AdultLevel[], group: boolean): string {
  const effective = lowestLevel(...levels)
  if (effective === 'shown') return 'You see adult games and their pictures.'
  const at = levels.indexOf(effective)
  const label = adultLabels[effective]
  const reason = [
    `this installation is set to ${label}`,
    group ? `your sign-in group allows at most ${label}` : `your account allows at most ${label}`,
    `you chose ${label}`,
    `you chose ${label} on this device`,
  ][at]
  return effective === 'blurred' ? `You see adult games with their pictures blurred, because ${reason}.` : `Adult games are hidden, because ${reason}.`
}

const installationSource = (s: { fixed: boolean; chosen: boolean }) =>
  s.fixed ? 'Fixed by the server with the variable RENPLAY_ADULT_GAMES' : s.chosen ? 'Set by the admin' : 'Default'

/** The account page's ladder: installation, account, you and this device. Each row can only narrow the one above. */
export default function AdultLadder() {
  const { data: state, error } = useAdultState()
  const [device, setDevice] = useDeviceLevel()
  const setChoice = useSetAdultChoice()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (error) return <p className="text-sm text-rose-300">{errorText(error)}</p>
  if (!state) return <Spinner />
  const installation = state.installation.level
  const ceiling = state.ceiling.level
  const yours = lowestLevel(installation, ceiling)
  const here = lowestLevel(yours, state.choice)
  const choose = async (level: AdultLevel) => {
    setBusy(true)
    try {
      await setChoice(level)
    } catch (e) {
      toast(errorText(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      <Row title="This installation" source={installationSource(state.installation)}>
        <LevelPills label="This installation" value={installation} />
      </Row>
      <Row title="Your account" source={state.ceiling.managed === 'group' ? 'Set by your sign-in group' : 'Set by the admin'}>
        <LevelPills label="Your account" value={ceiling} max={installation} />
      </Row>
      <Row title="You" source="Your choice, on every device">
        <LevelPills label="You" value={state.choice} max={yours} onChange={(level) => void choose(level)} busy={busy} />
      </Row>
      <Row title="This device" source={device ? 'This browser only' : 'Follows your choice'}>
        <LevelPills label="This device" value={device ? lowestLevel(here, device) : here} max={here} onChange={(level) => setDevice(level === here ? null : level)} />
      </Row>
      <p className="text-sm text-zinc-300">{summary([installation, ceiling, state.choice, device ?? 'shown'], state.ceiling.managed === 'group')}</p>
    </div>
  )
}

/** Settings, This device: only the device row. The other levels live on the account page. */
export function DeviceAdultRow() {
  const { data: state } = useAdultState()
  const [device, setDevice] = useDeviceLevel()
  if (!state) return null
  const here = state.effective
  return (
    <div className="space-y-3">
      <Row title="Adult games on this device" source={device ? 'This browser only' : 'Follows your choice'}>
        <LevelPills label="Adult games on this device" value={device ? lowestLevel(here, device) : here} max={here} onChange={(level) => setDevice(level === here ? null : level)} />
      </Row>
      <p className="text-xs text-zinc-400">
        This browser can show less than your account, never more. All levels are on your <Link to="/account" className="text-accent-300 underline">account page</Link>.
      </p>
    </div>
  )
}
