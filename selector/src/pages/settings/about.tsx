import DocsLink from '../../components/DocsLink'
import { LanternSwitch, SourceLabel } from '../../lantern/controls'
import { put } from '../../lib/api'
import { useSystem } from '../../lib/queries'
import { Setting, setBy, useRun } from './common'

/** The version, the license and links, and the switch for the usage report. */
export function AboutPanel() {
  const { data: sys } = useSystem()
  const run = useRun()
  if (!sys) return null
  return (
      <section className="panel stack" style={{ gap: 10 }}>
        <h2 className="h3">About Renplay</h2>
        <p className="small muted">Version {sys.version} · Made by the Renplay Team</p>
        <p className="small muted">Renplay is open source, under the MIT license. Game art belongs to its developers.</p>
        {sys.telemetry && (
          <Setting
            title="Send an anonymous usage report"
            hint={<>Once a day Renplay sends counts of how it is used, never names, titles or saves. <DocsLink path="telemetry/">What it sends</DocsLink></>}
            inline
            source={sys.telemetry.locked ? setBy(sys, 'RENPLAY_TELEMETRY') : <SourceLabel kind={sys.telemetry.chosen ? 'here' : 'def'} />}
          >
            <LanternSwitch checked={sys.telemetry.on} disabled={sys.telemetry.locked} label="Send an anonymous usage report" onChange={(on) => void run(() => put('/api/system/telemetry', { on }), on ? 'The usage report is on' : 'The usage report is off')} />
          </Setting>
        )}
        <div className="actions" style={{ gap: 16 }}>
          <DocsLink />
          <DocsLink path="troubleshooting/">Troubleshooting</DocsLink>
          <a className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="https://renplay.org/releases" target="_blank" rel="noreferrer">Release notes ↗</a>
          <a className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="https://renplay.org/github" target="_blank" rel="noreferrer">GitHub ↗</a>
          <a className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="https://renplay.org/support" target="_blank" rel="noreferrer">Support ↗</a>
          <a className="link small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} href="https://github.com/renplay-org/renplay/blob/main/LICENSE" target="_blank" rel="noreferrer">License ↗</a>
        </div>
      </section>
  )
}
