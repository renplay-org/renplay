import { Package } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import DocsLink from '../../components/DocsLink'
import { Confirm } from '../../lantern/ui'
import { LevelSeg } from '../../components/AdultLadder'
import { SourceLabel, Pill } from '../../lantern/controls'
import { post } from '../../lib/api'
import { bytes } from '@shared/format'
import { adultLabels } from '../../lib/adult'
import { ADULT_LEVELS, type AdultLevel } from '@shared/levels'
import { useContent, useGames, useSetInstallationLevel, useSystem } from '../../lib/queries'
import { Setting, useRun } from './common'

const installationHint: Record<AdultLevel, string> = {
  off: 'Adult games are hidden for everyone and cannot be installed. Games already in the library stay, hidden.',
  blurred: 'Adult games show for everyone whose account allows it, without their pictures. Renplay never downloads their art.',
  shown: 'Adult games and their pictures show for everyone whose account allows it.',
}

/** Sign-in is off: everyone plays as one account. */
export function SignInOff({ userName }: { userName: string }) {
  const { data: sys } = useSystem()
  return (
      <section className="panel">
        <Setting
          title="Sign-in is off"
          hint={`Everyone who opens this address plays as ${userName}. That is fine on a private network. Turn it on when more people or the internet can reach it.`}
          source={sys?.setBy?.['RENPLAY_AUTH'] === 'server' ? <SourceLabel kind="server" label="RENPLAY_AUTH" /> : <SourceLabel kind="def" />}
        >
          <Pill size="sm" onClick={() => window.open('https://renplay.org/docs/accounts/', '_blank', 'noreferrer')}>
            How to turn it on
          </Pill>
        </Setting>
      </section>
  )
}

/** The installation's level for adult games, with the starting level and the sign-in groups. */
export function AdultGamesPanel() {
  const { data: content } = useContent()
  const setInstallationLevel = useSetInstallationLevel()
  const [raiseTo, setRaiseTo] = useState<AdultLevel | null>(null)
  const run = useRun()
  if (!content) return null
  return (
    <>
        <section className="panel">
          <h2 className="h3" style={{ marginBottom: 10 }}>Adult games</h2>
          <div className="ladder">
            <div className="lrow">
              <div className="l">
                <div className="t">Highest level for everyone</div>
                <div className="d">{installationHint[content.installation.level]}</div>
                {content.installation.fixed ? <SourceLabel kind="server" label={content.installation.variable} /> : content.installation.chosen ? <SourceLabel kind="here" /> : <SourceLabel kind="def" />}
              </div>
              <LevelSeg
                label="Highest level for everyone"
                value={content.installation.level}
                onChange={
                  content.installation.fixed
                    ? undefined
                    : (level) => {
                        if (level === content.installation.level) return
                        if (ADULT_LEVELS.indexOf(level) > ADULT_LEVELS.indexOf(content.installation.level)) setRaiseTo(level)
                        else void run(() => setInstallationLevel(level), 'Adult games level saved')
                      }
                }
              />
            </div>
          </div>
          {content.starting && (
            <p className="small muted" style={{ marginTop: 12 }}>
              New people start at {adultLabels[content.starting.level]}, set with <code>{content.starting.variable}</code>. Change one person in <Link to="/settings/users" className="link">Users</Link>.
            </p>
          )}
          {content.groups && (content.groups.oidc || content.groups.ldap) && (
            <div className="small muted stack" style={{ marginTop: 10, gap: 6 }}>
              <p>Sign-in groups set the highest level of their members, at each sign-in. They replace the setting in Users.</p>
              <ul className="stack" style={{ gap: 4, paddingLeft: 18 }}>
                {content.groups.oidc && Object.entries(content.groups.oidc.map).map(([group, level]) => <li key={`oidc-${group}`}>Single sign-on group <span className="muted-2">{group}</span>: {adultLabels[level]}</li>)}
                {content.groups.ldap?.map && Object.entries(content.groups.ldap.map).map(([group, level]) => <li key={`ldap-${group}`}>LDAP group <span className="muted-2">{group}</span>: {adultLabels[level]}</li>)}
                {content.groups.ldap && !content.groups.ldap.map && <li>LDAP entries that match <code>{content.groups.ldap.variable}</code>: Shown, others Off</li>}
              </ul>
              <p className="xs">Set with {[content.groups.oidc?.variable, content.groups.ldap?.variable].filter(Boolean).join(' and ')}.</p>
            </div>
          )}
          <p style={{ marginTop: 'var(--s4)' }}>
            <DocsLink path="start-here/adult-games/">Adult games</DocsLink>
          </p>
        </section>
      <Confirm open={!!raiseTo} onClose={() => setRaiseTo(null)} title={raiseTo === 'shown' ? 'Show adult games and their pictures?' : 'Show adult games without pictures?'} confirmLabel={raiseTo ? `Set to ${adultLabels[raiseTo]}` : 'Confirm'} onConfirm={() => void run(() => setInstallationLevel(raiseTo!), 'Adult games level saved').then(() => setRaiseTo(null))}>
        {raiseTo ? installationHint[raiseTo] : null}
      </Confirm>
    </>
  )
}

/** The Ren'Py web engines this server has, and which games use them. */
export function EnginesPanel() {
  const { data: sys } = useSystem()
  const { data: games } = useGames()
  const installed = (games ?? []).filter((g) => g.status === 'installed')
  const run = useRun()
  if (!sys) return null
  return (
    <section className="panel">
      <h2 className="h3 row" style={{ gap: 8, marginBottom: 6 }}>
        <Package style={{ width: 18, height: 18 }} /> Ren’Py engines
      </h2>
      <p className="small muted">Games run on the official Ren’Py web engine of a matching version, downloaded the first time a game needs it and shared by all games that use it. Unused engines are removed automatically.</p>
      <div className="list tight small" style={{ marginTop: 10 }}>
        {sys.engines.installed.length === 0 && <p className="muted">None installed yet.</p>}
        {sys.engines.installed.map((e) => (
          <div key={e.version} className="row between">
            <span>Ren’Py {e.version}</span>
            <span className="xs muted" style={{ textAlign: 'right' }}>
              {bytes(e.bytes)} · {e.usedBy.length ? installed.filter((g) => g.engine === e.version).map((g) => g.title).join(', ') || 'Games are loading' : 'Unused'}
            </span>
          </div>
        ))}
      </div>
      <p className="xs muted" style={{ marginTop: 10 }}>
        {sys.engines.available.length ? `Available: ${sys.engines.available.map((e) => e.version).join(', ')}` : 'The engine index is unreachable.'} ·{' '}
        <a className="link-q" href="https://renplay.org/github/engines" target="_blank" rel="noreferrer">
          Engines on GitHub
        </a>
      </p>
      {sys.engines.installed.some((e) => !e.usedBy.length) && (
        <div style={{ marginTop: 12 }}>
          <Pill size="sm" onClick={() => run(() => post('/api/system/prune'), 'Unused engines removed')}>
            Remove unused engines
          </Pill>
        </div>
      )}
    </section>
  )
}
