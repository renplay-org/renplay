import { useState } from 'react'
import { Link } from 'react-router-dom'
import { adultLabels, adultLevels, lowestLevel, useAdultState, useDeviceLevel, useSetAdultChoice, type AdultLevel } from '../lib/adult'
import { Seg, SourceLabel } from '../lantern/controls'
import { useAuth } from '../lib/auth'
import { errorText, Spinner, useToast } from './ui'

/**
 * Three pills, Off, Blurred and Shown. A pill above `max` (the row above) is
 * struck through and cannot be chosen. Without `onChange` the row is fixed.
 */
export function LevelSeg({ label, value, max = 'shown', onChange, busy }: { label: string; value: AdultLevel; max?: AdultLevel; onChange?: (level: AdultLevel) => void; busy?: boolean }) {
  return (
    <Seg
      small
      label={label}
      value={value}
      onChange={onChange}
      disabled={busy}
      options={adultLevels.map((level) => ({
        value: level,
        label: adultLabels[level],
        na: adultLevels.indexOf(level) > adultLevels.indexOf(max),
        disabled: !onChange || adultLevels.indexOf(level) > adultLevels.indexOf(max),
      }))}
    />
  )
}

function LadderRow({ title, sub, source, fixed, children }: { title: string; sub?: string; source?: React.ReactNode; fixed?: boolean; children: React.ReactNode }) {
  return (
    // `locked`, not `fixed`: Tailwind's fixed is position: fixed.
    <div className={`lrow ${fixed ? 'locked' : ''}`.trim()}>
      <div className="l">
        <div className="t">{title}</div>
        {sub && <div className="d">{sub}</div>}
        {source}
      </div>
      {children}
    </div>
  )
}

/** What the person sees, in one sentence. */
function seeing(level: AdultLevel): string {
  return level === 'shown' ? 'You see adult games and their pictures.' : level === 'blurred' ? 'You see adult games with their pictures blurred.' : 'Adult games are hidden for you.'
}

/**
 * The account page: one choice, Off, Blurred or Shown. Levels above the limit cannot be chosen, and
 * one line says who sets that limit. When this browser shows less, a line says so with the way back.
 */
export default function AdultChoice() {
  const { data: state, error } = useAdultState()
  const { data: me } = useAuth()
  const [device, setDevice] = useDeviceLevel()
  const setChoice = useSetAdultChoice()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (error) return <p className="red small">{errorText(error)}</p>
  if (!state) return <Spinner />
  const installation = state.installation.level
  const limit = lowestLevel(installation, state.ceiling.level)
  const yours = lowestLevel(limit, state.choice)
  const here = device ? lowestLevel(yours, device) : yours
  const admin = me?.user.role === 'admin'
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
  const who =
    limit === 'shown'
      ? null
      : installation === limit
        ? admin
          ? <>This installation allows up to {adultLabels[limit]}. <Link to="/settings" className="link">Change it in Settings</Link>.</>
          : <>This installation allows up to {adultLabels[limit]}.</>
        : state.ceiling.managed === 'group'
          ? <>Your sign-in group allows up to {adultLabels[limit]}.</>
          : <>An admin set your limit to {adultLabels[limit]}.</>
  return (
    <div className="stack" style={{ gap: 10, alignItems: 'flex-start' }}>
      <LevelSeg label="Adult games" value={state.choice} max={limit} onChange={(level) => void choose(level)} busy={busy} />
      <p className="small muted-2">{seeing(yours)}</p>
      {who && <p className="xs muted">{who}</p>}
      {device && here !== yours && (
        <p className="xs muted">
          {here === 'off' ? 'In this browser adult games are hidden.' : 'In this browser their pictures are blurred.'}{' '}
          <button type="button" className="link" onClick={() => setDevice(null)}>
            Follow my choice here
          </button>
        </p>
      )}
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
    <div className="ladder">
      <LadderRow title="Adult games in this browser" sub="On a shared screen, show less here than your choice on your account page. Never more." source={device ? <SourceLabel kind="here" /> : <SourceLabel kind="def" />}>
        <LevelSeg label="Adult games in this browser" value={device ? lowestLevel(here, device) : here} max={here} onChange={(level) => setDevice(level === here ? null : level)} />
      </LadderRow>
    </div>
  )
}
